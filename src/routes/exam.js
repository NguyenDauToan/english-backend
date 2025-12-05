import express from "express";
import mongoose from "mongoose";
import Test from "../models/test.js";
import Question from "../models/question.js";
import User from "../models/user.js";
import School from "../models/school.js";
import Classroom from "../models/classroom.js";
import SchoolYear from "../models/schoolYear.js";
import { verifyToken, verifyRole } from "../middleware/auth.js";
import { sendNewExamEmail } from "../utils/mailer.js";

const router = express.Router();

/* =========================
  HÀM HỖ TRỢ NĂM HỌC HIỆN TẠI
  ========================= */
async function getCurrentActiveYear() {
  // lấy năm học đang active mới nhất
  return SchoolYear.findOne({ isActive: true }).sort({ startDate: -1 });
}

async function requireCurrentActiveYear(res) {
  const year = await getCurrentActiveYear();
  if (!year) {
    res
      .status(400)
      .json({ message: "Chưa cấu hình năm học hiện tại (isActive = true)" });
    return null;
  }
  return year;
}

/* =========================
  🧩 1. Tạo bài thi thủ công
  ========================= */
router.post(
  "/",
  verifyToken,
  verifyRole(["teacher", "admin", "school_manager"]),
  async (req, res) => {
    try {
      const {
        title,
        description,
        duration,
        level,
        grade,
        questions,
        skill,
        schoolId,
        classroomId,
        scope, // "class" | "grade"
      } = req.body;

      if (!questions?.length)
        return res
          .status(400)
          .json({ message: "Cần cung cấp danh sách câu hỏi" });

      if (!duration || typeof duration !== "number" || duration <= 0)
        return res.status(400).json({
          message: "Cần cung cấp thời gian làm bài hợp lệ (phút)",
        });

      // 👉 luôn gắn theo năm học đang active
      const currentYear = await requireCurrentActiveYear(res);
      if (!currentYear) return;

      let school = null;
      let classroom = null;
      let finalSchoolId = schoolId;

      if (req.user.role === "admin") {
        // admin: được phép chọn bất kỳ schoolId (nếu có)
        if (schoolId) {
          school = await School.findById(schoolId);
          if (!school) {
            return res.status(400).json({ message: "Trường không tồn tại" });
          }
        }
      } else {
        // teacher / school_manager: BẮT BUỘC dùng trường của mình
        if (!req.user.school) {
          return res
            .status(400)
            .json({ message: "Tài khoản chưa gắn với trường nào" });
        }
        // nếu FE cố gửi schoolId khác -> chặn
        if (schoolId && String(schoolId) !== String(req.user.school)) {
          return res.status(403).json({
            message: "Không được tạo đề thi cho trường khác",
          });
        }
        finalSchoolId = req.user.school;
        school = await School.findById(finalSchoolId);
        if (!school) {
          return res.status(400).json({ message: "Trường không tồn tại" });
        }
      }

      const isGradeScope = scope === "grade";

      // Nếu áp dụng cho KHỐI → cần grade, không bắt buộc classroomId
      if (isGradeScope) {
        if (!grade) {
          return res
            .status(400)
            .json({
              message:
                "Vui lòng chọn khối lớp (grade) khi áp dụng đề thi cho toàn bộ khối",
            });
        }
      } else {
        // Mặc định: áp dụng theo LỚP → bắt buộc classroomId
        if (!classroomId) {
          return res
            .status(400)
            .json({ message: "Vui lòng chọn lớp áp dụng đề thi" });
        }

        classroom = await Classroom.findById(classroomId);
        if (!classroom) {
          return res.status(400).json({ message: "Lớp không tồn tại" });
        }
        if (
          finalSchoolId &&
          classroom.school &&
          String(classroom.school) !== String(finalSchoolId)
        ) {
          return res
            .status(400)
            .json({ message: "Lớp không thuộc trường đã chọn" });
        }

        // ✅ giáo viên chỉ được tạo đề cho lớp mình phụ trách
        if (req.user.role === "teacher") {
          const teacherId = req.user.id || req.user._id;
          if (
            !classroom.homeroomTeacher ||
            String(classroom.homeroomTeacher) !== String(teacherId)
          ) {
            return res.status(403).json({
              message: "Bạn chỉ được tạo đề cho các lớp mình phụ trách",
            });
          }
        }
      }

      // ===== CHECK TRÙNG TÊN ĐỀ THI (trong cùng trường + lớp/khối + năm học) =====
      const normalizedTitle = (title || "").trim();
      if (normalizedTitle) {
        const examSchoolId = school ? school._id : finalSchoolId || undefined;
        // grade-scope: classroom = null; class-scope: id lớp
        const examClassroomId = isGradeScope
          ? null
          : classroom
          ? classroom._id
          : classroomId || null;

        const existingExam = await Test.findOne({
          title: normalizedTitle,
          school: examSchoolId || null,
          classroom: examClassroomId, // null nếu áp dụng khối
          schoolYear: currentYear._id,
        }).collation({ locale: "vi", strength: 2 }); // không phân biệt hoa-thường

        if (existingExam) {
          return res.status(400).json({
            message:
              "Tên đề thi này đã tồn tại trong trường/lớp/năm học này, vui lòng chọn tên khác",
          });
        }
      }

      let status = "pending";
      if (req.user.role === "admin" || req.user.role === "school_manager") {
        status = "approved";
      }

      const examSchoolId = school ? school._id : finalSchoolId || undefined;
      const examClassroomId = isGradeScope
        ? null
        : classroom
        ? classroom._id
        : classroomId || undefined;

      const exam = await Test.create({
        title: normalizedTitle || title, // lưu bản đã trim
        description,
        duration,
        level: level || "mixed",
        grade,
        skill: skill || undefined,
        questions,
        createdBy: req.user._id,
        school: examSchoolId,
        classroom: examClassroomId,
        schoolYear: currentYear._id,
        status,
        approvedBy: status === "approved" ? req.user._id : undefined,
        approvedAt: status === "approved" ? new Date() : undefined,
      });

      const populatedExam = await Test.findById(exam._id)
        .populate({
          path: "questions",
          select:
            "content type options answer skill grade level subQuestions audioUrl explanation",
        })
        .populate("school", "name code")
        .populate("classroom", "name code")
        .populate("schoolYear", "name isActive startDate endDate");

      if (status === "approved") {
        await notifyStudentsNewExam(populatedExam);
      }
      const io = req.app.get("io");
      if (io && exam.status === "pending") {
        io.to("exam-moderators").emit("exam:pending-updated", {
          kind: "skill",
          examId: exam._id.toString(),
          action: "created",
          status: exam.status,
          schoolId: exam.school,
          classroomId: exam.classroom,
        });
      }
      res.status(201).json(populatedExam);
    } catch (err) {
      console.error("Lỗi tạo bài thi:", err);
      res.status(500).json({ message: err.message });
    }
  }
);

/* =========================
  👤 1.5. Các đề thi của giáo viên hiện tại
  ========================= */
router.get(
  "/mine",
  verifyToken,
  verifyRole(["teacher"]),
  async (req, res) => {
    try {
      const exams = await Test.find({ createdBy: req.user._id })
        .populate(
          "questions",
          "content skill level grade subQuestions type options answer audioUrl explanation"
        )
        .populate("school", "name code")
        .populate("classroom", "name code")
        .populate("schoolYear", "name isActive startDate endDate")
        .sort({ createdAt: -1 });

      res.json(exams);
    } catch (err) {
      console.error("Lỗi lấy danh sách đề của giáo viên:", err);
      res.status(500).json({ message: err.message });
    }
  }
);

/* =========================
  📘 2. Lấy danh sách bài thi
  ========================= */
router.get("/", verifyToken, async (req, res) => {
  try {
    const {
      skill,
      grade: queryGrade,
      level,
      schoolId,
      classroomId,
      status,
      schoolYearId,
    } = req.query;

    const {
      role,
      school: userSchool,
      classroom: userClassroom,
      grade: userGrade,
      currentSchoolYear,
    } = req.user;

    const filter = {};

    // lọc theo level (áp dụng cho mọi role nếu FE gửi)
    if (level) filter.level = level;

    // ===== PHẠM VI THEO TRƯỜNG + NĂM HỌC =====
    if (role === "admin") {
      if (schoolId) {
        filter.school = schoolId;
      }
      if (schoolYearId) {
        filter.schoolYear = schoolYearId;
      }
      // admin có thể xem tất cả nếu không truyền schoolYearId
    } else {
      // student / teacher / school_manager: chỉ trong trường mình
      if (!userSchool) {
        return res
          .status(400)
          .json({ message: "Tài khoản chưa gắn với trường nào" });
      }
      filter.school = userSchool;

      // luôn ưu tiên query.schoolYearId, sau đó currentSchoolYear, cuối cùng auto năm active
      let yearFilterId = schoolYearId || currentSchoolYear;

      if (!yearFilterId) {
        const currentYear = await getCurrentActiveYear();
        if (currentYear) {
          yearFilterId = currentYear._id;
        }
      }

      if (yearFilterId) {
        filter.schoolYear = yearFilterId;
      }
    }

    // ===== PHẠM VI THEO CLASS / GRADE =====
    if (role === "student") {
      // học sinh: không tin grade / classroomId từ query
      // chỉ cho:
      //  - đề target đúng lớp (classroom = user.classroom)
      //  - hoặc đề áp dụng khối (classroom = null, grade = user.grade)
      filter.status = "approved";

      const orConditions = [];

      if (userClassroom) {
        orConditions.push({ classroom: userClassroom });
      }

      if (userGrade) {
        orConditions.push({ classroom: null, grade: userGrade });
      }

      if (orConditions.length > 0) {
        filter.$or = orConditions;
      }
    } else {
      // teacher / school_manager / admin
      // cho phép lọc thêm theo grade và classroomId nếu FE gửi
      if (queryGrade) {
        filter.grade = queryGrade;
      }
      if (classroomId) {
        filter.classroom = classroomId;
      }

      if (status) {
        filter.status = status;
      }
    }

    // ===== QUERY =====
    if (!skill) {
      const exams = await Test.find(filter)
        .populate({
          path: "questions",
          select:
            "content type options answer skill grade level subQuestions audioUrl explanation",
        })
        .populate("school", "name code")
        .populate("classroom", "name code")
        .populate("schoolYear", "name isActive startDate endDate")
        .populate("createdBy", "name email")
        .sort({ createdAt: -1 });

      return res.json(exams);
    }

    // có filter skill
    const exams = await Test.find(filter)
      .populate({
        path: "questions",
        match: { skill },
        select:
          "content type options answer skill grade level subQuestions audioUrl explanation",
      })
      .populate("school", "name code")
      .populate("classroom", "name code")
      .populate("schoolYear", "name isActive startDate endDate")
      .populate("createdBy", "name email")
      .sort({ createdAt: -1 });

    const filteredExams = exams
      .map((exam) => ({
        ...exam.toObject(),
        questions: (exam.questions || []).filter((q) => q.skill === skill),
      }))
      .filter((exam) => exam.questions.length > 0);

    res.json(filteredExams);
  } catch (err) {
    console.error("❌ Lỗi khi lấy bài thi:", err);
    res.status(500).json({ message: err.message });
  }
});

/* =========================
  📄 3. Lấy chi tiết 1 bài thi (có thể lọc theo skill cho học sinh)
  ========================= */
router.get("/:id", verifyToken, async (req, res) => {
  const { id } = req.params;
  const { skill } = req.query; // 👈 lấy skill từ query, ví dụ ?skill=listening

  if (!mongoose.Types.ObjectId.isValid(id)) {
    return res.status(400).json({ message: "ID bài thi không hợp lệ" });
  }

  try {
    const exam = await Test.findById(id)
      .populate({
        path: "questions",
        select:
          "content type options answer skill grade level subQuestions audioUrl explanation",
      })
      .populate("school", "name code")
      .populate("classroom", "name code")
      .populate("schoolYear", "name isActive startDate endDate");

    if (!exam) {
      return res.status(404).json({ message: "Bài thi không tồn tại" });
    }

    const {
      role,
      school: userSchool,
      classroom: userClassroom,
      grade: userGrade,
    } = req.user;

    const examSchoolId =
      exam.school && exam.school._id ? exam.school._id : exam.school;

    // không phải admin: bắt buộc cùng trường
    if (role !== "admin") {
      if (!userSchool || String(examSchoolId) !== String(userSchool)) {
        return res
          .status(403)
          .json({ message: "Không có quyền xem đề thi của trường khác" });
      }
    }

    // học sinh: thêm ràng buộc lớp/khối + trạng thái duyệt
    if (role === "student") {
      if (exam.status !== "approved") {
        return res
          .status(403)
          .json({ message: "Đề thi chưa được duyệt, không thể truy cập" });
      }

      const examClassroomId =
        exam.classroom && exam.classroom._id
          ? exam.classroom._id
          : exam.classroom;

      let allowed = false;

      // 1) đề theo lớp
      if (examClassroomId && userClassroom) {
        if (String(examClassroomId) === String(userClassroom)) {
          allowed = true;
        }
      }

      // 2) đề theo khối (classroom = null, grade = user.grade)
      if (!allowed && examClassroomId == null && exam.grade && userGrade) {
        if (exam.grade === userGrade) {
          allowed = true;
        }
      }

      if (!allowed) {
        return res.status(403).json({
          message:
            "Bạn không được phép làm đề thi này (không đúng lớp hoặc khối trong trường của bạn)",
        });
      }
    }

    // ✅ LỌC CÂU HỎI THEO KỸ NĂNG (nếu client truyền ?skill=...)
    let questions = exam.questions || [];

    if (skill) {
      const skillStr = String(skill);
      questions = questions.filter((q) => q.skill === skillStr);
    }

    return res.json({
      ...exam.toObject(),
      questions,
    });
  } catch (err) {
    console.error("Lỗi lấy chi tiết bài thi:", err);
    return res.status(500).json({ message: err.message });
  }
});

/* =========================
  ✏️ 4. Cập nhật bài thi
  ========================= */
router.put(
  "/:id",
  verifyToken,
  verifyRole(["teacher", "admin", "school_manager"]),
  async (req, res) => {
    try {
      const exam = await Test.findById(req.params.id);
      if (!exam)
        return res.status(404).json({ message: "Bài thi không tồn tại" });

      if (req.user.role !== "admin") {
        if (!req.user.school || String(exam.school) !== String(req.user.school)) {
          return res
            .status(403)
            .json({ message: "Không có quyền sửa đề thi của trường khác" });
        }
      }

      const {
        title,
        description,
        duration,
        level,
        grade,
        questions,
        skill,
        schoolId,
        classroomId,
      } = req.body;

      const update = {
        title,
        description,
        duration,
        level,
        grade,
        questions,
        skill,
      };

      let school = null;
      let classroom = null;

      if (req.user.role === "admin") {
        if (schoolId) {
          school = await School.findById(schoolId);
          if (!school) {
            return res.status(400).json({ message: "Trường không tồn tại" });
          }
          update.school = school._id;
        } else if (typeof schoolId !== "undefined") {
          update.school = undefined;
        }
      }

      if (classroomId) {
        classroom = await Classroom.findById(classroomId);
        if (!classroom) {
          return res.status(400).json({ message: "Lớp không tồn tại" });
        }

        if (
          (school || exam.school) &&
          classroom.school &&
          String(classroom.school) !==
            String(school ? school._id : exam.school)
        ) {
          return res
            .status(400)
            .json({ message: "Lớp không thuộc trường đã chọn" });
        }

        update.classroom = classroom._id;
      } else if (typeof classroomId !== "undefined") {
        update.classroom = undefined;
      }

      // ===== CHECK TRÙNG TÊN KHI UPDATE (theo trường + lớp + năm học) =====
      const normalizedTitle = (title || "").trim();
      if (normalizedTitle) {
        // nếu không đổi school/classroom thì dùng của exam
        const newSchoolId =
          typeof update.school !== "undefined" ? update.school : exam.school;
        const newClassroomId =
          typeof update.classroom !== "undefined"
            ? update.classroom
            : exam.classroom;

        const dup = await Test.findOne({
          _id: { $ne: exam._id }, // loại trừ chính nó
          title: normalizedTitle,
          school: newSchoolId || null,
          classroom: newClassroomId || null,
          schoolYear: exam.schoolYear || null,
        }).collation({ locale: "vi", strength: 2 });

        if (dup) {
          return res.status(400).json({
            message:
              "Tên đề thi này đã tồn tại trong trường/lớp/năm học này, vui lòng chọn tên khác",
          });
        }

        update.title = normalizedTitle;
      }

      const updatedExam = await Test.findByIdAndUpdate(
        req.params.id,
        update,
        {
          new: true,
        }
      )
        .populate({
          path: "questions",
          select:
            "content type options answer skill grade level subQuestions audioUrl explanation",
        })
        .populate("school", "name code")
        .populate("classroom", "name code")
        .populate("schoolYear", "name isActive startDate endDate");

      res.json(updatedExam);
    } catch (err) {
      console.error("Lỗi cập nhật bài thi:", err);
      res.status(500).json({ message: err.message });
    }
  }
);

/* =========================
  ❌ 5. Xóa bài thi
  ========================= */
router.delete(
  "/:id",
  verifyToken,
  // CHỈ admin và school_manager được xoá
  verifyRole(["admin", "school_manager"]),
  async (req, res) => {
    try {
      const exam = await Test.findById(req.params.id);
      if (!exam)
        return res.status(404).json({ message: "Bài thi không tồn tại" });

      if (req.user.role !== "admin") {
        // school_manager vẫn chỉ được xoá trong trường mình
        if (!req.user.school || String(exam.school) !== String(req.user.school)) {
          return res
            .status(403)
            .json({ message: "Không có quyền xoá đề thi của trường khác" });
        }
      }

      await exam.deleteOne();
      res.json({ message: "Xóa bài thi thành công" });
    } catch (err) {
      console.error("Lỗi xoá bài thi:", err);
      res.status(500).json({ message: err.message });
    }
  }
);

/* =========================
  ⚙️ 6. Sinh bài thi tự động
  ========================= */
router.post(
  "/generate",
  verifyToken,
  verifyRole(["teacher", "admin", "school_manager"]),
  async (req, res) => {
    try {
      const {
        title,
        description,
        duration,
        rules,
        level,
        grade,
        schoolId,
        classroomId,
        scope, // thêm để hỗ trợ khối / lớp
      } = req.body;

      if (!rules?.length)
        return res
          .status(400)
          .json({ message: "Cần cung cấp quy tắc chọn câu hỏi" });

      if (!duration || typeof duration !== "number" || duration <= 0)
        return res.status(400).json({
          message: "Cần cung cấp thời gian làm bài hợp lệ (phút)",
        });

      // 👉 luôn gắn theo năm học đang active
      const currentYear = await requireCurrentActiveYear(res);
      if (!currentYear) return;

      let school = null;
      let classroom = null;
      let finalSchoolId = schoolId;

      if (req.user.role === "admin") {
        if (schoolId) {
          school = await School.findById(schoolId);
          if (!school) {
            return res.status(400).json({ message: "Trường không tồn tại" });
          }
        }
      } else {
        if (!req.user.school) {
          return res
            .status(400)
            .json({ message: "Tài khoản chưa gắn với trường nào" });
        }
        if (schoolId && String(schoolId) !== String(req.user.school)) {
          return res
            .status(403)
            .json({ message: "Không được tạo đề thi cho trường khác" });
        }
        finalSchoolId = req.user.school;
        school = await School.findById(finalSchoolId);
        if (!school) {
          return res.status(400).json({ message: "Trường không tồn tại" });
        }
      }

      const isGradeScope = scope === "grade";

      if (isGradeScope) {
        if (!grade) {
          return res.status(400).json({
            message:
              "Vui lòng chọn khối lớp (grade) khi áp dụng đề thi cho toàn bộ khối",
          });
        }
      } else {
        if (!classroomId) {
          return res
            .status(400)
            .json({ message: "Vui lòng chọn lớp áp dụng đề thi" });
        }

        classroom = await Classroom.findById(classroomId);
        if (!classroom) {
          return res.status(400).json({ message: "Lớp không tồn tại" });
        }

        if (
          finalSchoolId &&
          classroom.school &&
          String(classroom.school) !== String(finalSchoolId)
        ) {
          return res
            .status(400)
            .json({ message: "Lớp không thuộc trường đã chọn" });
        }

        if (req.user.role === "teacher") {
          const teacherId = req.user.id || req.user._id;
          if (
            !classroom.homeroomTeacher ||
            String(classroom.homeroomTeacher) !== String(teacherId)
          ) {
            return res.status(403).json({
              message: "Bạn chỉ được tạo đề cho các lớp mình phụ trách",
            });
          }
        }
      }

      let selectedQuestions = [];

      for (const rule of rules) {
        const match = {};
        if (rule.skill) match.skill = rule.skill;
        if (rule.level) match.level = rule.level;
        if (grade) match.grade = grade;

        const questions = await Question.aggregate([
          { $match: match },
          { $sample: { size: rule.count } },
        ]);

        selectedQuestions.push(...questions);
      }

      // ===== CHECK TRÙNG TÊN (theo trường + lớp/khối + năm học) =====
      const normalizedTitle = (title || "").trim();
      const examSchoolId = school ? school._id : finalSchoolId || undefined;
      const examClassroomId = isGradeScope
        ? null
        : classroom
        ? classroom._id
        : classroomId || null;

      if (normalizedTitle) {
        const existingExam = await Test.findOne({
          title: normalizedTitle,
          school: examSchoolId || null,
          classroom: examClassroomId,
          schoolYear: currentYear._id,
        }).collation({ locale: "vi", strength: 2 });

        if (existingExam) {
          return res.status(400).json({
            message:
              "Tên đề thi này đã tồn tại trong trường/lớp/năm học này, vui lòng chọn tên khác",
          });
        }
      }

      let status = "pending";
      if (req.user.role === "admin" || req.user.role === "school_manager") {
        status = "approved";
      }

      const exam = await Test.create({
        title: normalizedTitle || title || "Untitled Exam",
        description,
        duration,
        level: level || "N/A",
        grade: grade || "N/A",
        questions: selectedQuestions.map((q) => q._id),
        createdBy: req.user._id,
        school: examSchoolId,
        classroom: examClassroomId,
        schoolYear: currentYear._id,
        status,
        approvedBy: status === "approved" ? req.user._id : undefined,
        approvedAt: status === "approved" ? new Date() : undefined,
      });

      const populatedExam = await Test.findById(exam._id)
        .populate({
          path: "questions",
          select:
            "content type options answer skill grade level subQuestions audioUrl explanation",
        })
        .populate("school", "name code")
        .populate("classroom", "name code")
        .populate("schoolYear", "name isActive startDate endDate");

      if (status === "approved") {
        await notifyStudentsNewExam(populatedExam);
      }

      // ⬇️ THÊM: báo cho trang Duyệt đề có đề mới (auto-generate)
      const io = req.app.get("io");
      if (io && exam.status === "pending") {
        io.to("exam-moderators").emit("exam:pending-updated", {
          kind: "skill", // đề kỹ năng
          examId: exam._id.toString(),
          action: "created", // auto-generate cũng coi là created
          status: exam.status,
          schoolId: exam.school,
          classroomId: exam.classroom,
        });
      }

      res.status(201).json(populatedExam);
    } catch (err) {
      console.error("Lỗi sinh bài thi tự động:", err);
      res.status(500).json({ message: err.message });
    }
  }
);

/* =========================
  💾 7. Lưu đề thi từ AI / builder
  ========================= */
router.post(
  "/save",
  verifyToken,
  verifyRole(["teacher", "admin", "school_manager"]),
  async (req, res) => {
    try {
      const {
        title,
        questions,
        skill,
        level,
        grade,
        duration,
        schoolId,
        classroomId,
        scope, // "class" | "grade"
      } = req.body;

      if (!questions || !questions.length) {
        return res.status(400).json({ message: "Chưa có câu hỏi để lưu" });
      }

      // 👉 luôn gắn theo năm học đang active
      const currentYear = await requireCurrentActiveYear(res);
      if (!currentYear) return;

      let school = null;
      let classroom = null;
      let finalSchoolId = schoolId;

      // ===== xác định trường giống các route khác =====
      if (req.user.role === "admin") {
        if (schoolId) {
          school = await School.findById(schoolId);
          if (!school) {
            return res.status(400).json({ message: "Trường không tồn tại" });
          }
        }
      } else {
        if (!req.user.school) {
          return res
            .status(400)
            .json({ message: "Tài khoản chưa gắn với trường nào" });
        }
        if (schoolId && String(schoolId) !== String(req.user.school)) {
          return res
            .status(403)
            .json({ message: "Không được tạo đề thi cho trường khác" });
        }
        finalSchoolId = req.user.school;
        school = await School.findById(finalSchoolId);
        if (!school) {
          return res.status(400).json({ message: "Trường không tồn tại" });
        }
      }

      const isGradeScope = scope === "grade";

      // Nếu áp dụng theo KHỐI: bắt buộc có grade
      if (isGradeScope) {
        if (!grade) {
          return res.status(400).json({
            message:
              "Vui lòng chọn khối lớp (grade) khi áp dụng cho cả khối",
          });
        }
        // KHÔNG bắt buộc classroomId, và cũng không dùng classroomId trong trường hợp này
      } else {
        // Mặc định: áp dụng theo LỚP → cần classroomId
        if (!classroomId) {
          return res
            .status(400)
            .json({ message: "Vui lòng chọn lớp áp dụng đề thi" });
        }

        classroom = await Classroom.findById(classroomId);
        if (!classroom) {
          return res.status(400).json({ message: "Lớp không tồn tại" });
        }

        if (
          finalSchoolId &&
          classroom.school &&
          String(classroom.school) !== String(finalSchoolId)
        ) {
          return res
            .status(400)
            .json({ message: "Lớp không thuộc trường đã chọn" });
        }

        if (req.user.role === "teacher") {
          const teacherId = req.user.id || req.user._id;
          if (
            !classroom.homeroomTeacher ||
            String(classroom.homeroomTeacher) !== String(teacherId)
          ) {
            return res.status(403).json({
              message: "Bạn chỉ được tạo đề cho các lớp mình phụ trách",
            });
          }
        }
      }

      // ===== TRẠNG THÁI DUYỆT =====
      let status = "pending";
      if (req.user.role === "admin" || req.user.role === "school_manager") {
        status = "approved";
      }

      const normalizedTitle = (title || "Untitled Exam").trim();
      const examSchoolId = school ? school._id : finalSchoolId || undefined;

      // Grade-scope: classroom = null; Class-scope: classroom = _id lớp
      const examClassroomId = isGradeScope
        ? null
        : classroom
        ? classroom._id
        : classroomId || null;

      // ===== CHECK TRÙNG TÊN (theo trường + lớp/khối + năm học) =====
      if (normalizedTitle) {
        const dup = await Test.findOne({
          title: normalizedTitle,
          school: examSchoolId || null,
          classroom: examClassroomId, // null nếu áp dụng cho khối
          schoolYear: currentYear._id,
        }).collation({ locale: "vi", strength: 2 });

        if (dup) {
          return res.status(400).json({
            message:
              "Tên đề thi này đã tồn tại trong trường/lớp/năm học này, vui lòng chọn tên khác",
          });
        }
      }

      const exam = await Test.create({
        title: normalizedTitle,
        questions,
        skill: skill || undefined,
        level,
        grade,
        duration,
        createdBy: req.user._id,
        school: examSchoolId || undefined,
        // grade-scope: classroom = null; class-scope: là id lớp
        classroom: examClassroomId,
        schoolYear: currentYear._id,
        status,
        approvedBy: status === "approved" ? req.user._id : undefined,
        approvedAt: status === "approved" ? new Date() : undefined,
      });

      const populatedExam = await Test.findById(exam._id)
        .populate("school", "name code")
        .populate("classroom", "name code")
        .populate("schoolYear", "name isActive startDate endDate");

      // chỉ gửi mail khi đã approved (admin / school_manager tạo)
      if (status === "approved") {
        await notifyStudentsNewExam(populatedExam);
      }

      res
        .status(201)
        .json({ message: "Đã lưu đề thi thành công", exam: populatedExam });
    } catch (err) {
      console.error("Lỗi lưu đề thi:", err);
      res.status(500).json({ message: "Lỗi lưu đề thi" });
    }
  }
);

// Chỉ gửi mail cho học sinh thuộc TRƯỜNG của bài thi
async function notifyStudentsNewExam(exam) {
  try {
    if (!exam.school) return;

    const students = await User.find({
      role: "student",
      school: exam.school,
    }).select("email name");

    const examLink = process.env.CLIENT_URL
      ? `${process.env.CLIENT_URL}/exams/${exam._id}`
      : "";

    await Promise.all(
      students
        .filter((s) => !!s.email)
        .map((s) =>
          sendNewExamEmail({
            to: s.email,
            studentName: s.name,
            examTitle: exam.title,
            duration: exam.duration,
            examLink,
          })
        )
    );
  } catch (mailErr) {
    console.error("Lỗi gửi mail thông báo đề thi:", mailErr);
  }
}

/* =========================
  ✅ 8. Duyệt đề thi
  ========================= */
router.patch(
  "/:id/approve",
  verifyToken,
  verifyRole(["admin", "school_manager"]),
  async (req, res) => {
    try {
      const { id } = req.params;

      const exam = await Test.findById(id);
      if (!exam) {
        return res.status(404).json({ message: "Bài thi không tồn tại" });
      }

      if (req.user.role !== "admin") {
        if (!req.user.school || String(exam.school) !== String(req.user.school)) {
          return res
            .status(403)
            .json({ message: "Không được duyệt đề thi của trường khác" });
        }
      }

      if (exam.status === "approved") {
        return res
          .status(400)
          .json({ message: "Bài thi đã được duyệt trước đó" });
      }

      exam.status = "approved";
      exam.approvedBy = req.user._id;
      exam.approvedAt = new Date();
      exam.rejectReason = "";
      await exam.save();

      const populatedExam = await Test.findById(exam._id)
        .populate({
          path: "questions",
          select:
            "content type options answer skill grade level subQuestions audioUrl explanation",
        })
        .populate("school", "name code")
        .populate("classroom", "name code")
        .populate("schoolYear", "name isActive startDate endDate");

      await notifyStudentsNewExam(populatedExam);
      const io = req.app.get("io");
      if (io) {
        io.to("exam-moderators").emit("exam:pending-updated", {
          kind: "skill",
          examId: exam._id.toString(),
          action: "approved",
          status: exam.status,
          schoolId: exam.school,
          classroomId: exam.classroom,
        });
      }
      res.json({ message: "Duyệt bài thi thành công", exam: populatedExam });
    } catch (err) {
      console.error("Lỗi duyệt bài thi:", err);
      res.status(500).json({ message: err.message });
    }
  }
);

/* =========================
  🚫 9. Từ chối đề thi
  ========================= */
router.patch(
  "/:id/reject",
  verifyToken,
  verifyRole(["admin", "school_manager"]),
  async (req, res) => {
    try {
      const { id } = req.params;
      const { reason } = req.body;

      const exam = await Test.findById(id);
      if (!exam) {
        return res.status(404).json({ message: "Bài thi không tồn tại" });
      }

      if (req.user.role !== "admin") {
        if (!req.user.school || String(exam.school) !== String(req.user.school)) {
          return res
            .status(403)
            .json({ message: "Không được từ chối đề thi của trường khác" });
        }
      }

      exam.status = "rejected";
      exam.approvedBy = req.user._id;
      exam.approvedAt = new Date();
      exam.rejectReason = reason || "";
      await exam.save();
      const io = req.app.get("io");
      if (io) {
        io.to("exam-moderators").emit("exam:pending-updated", {
          kind: "skill",
          examId: exam._id.toString(),
          action: "rejected",
          status: exam.status,
          schoolId: exam.school,
          classroomId: exam.classroom,
        });
      }
      res.json({ message: "Đã từ chối bài thi", exam });
    } catch (err) {
      console.error("Lỗi từ chối bài thi:", err);
      res.status(500).json({ message: err.message });
    }
  }
);

export default router;
