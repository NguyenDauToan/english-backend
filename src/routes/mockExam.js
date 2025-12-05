// routes/mockExam.js
import express from "express";
import mongoose from "mongoose";
import MockExam from "../models/mockExam.js";
import { verifyToken, verifyRole } from "../middleware/auth.js";
import Question from "../models/question.js";
import User from "../models/user.js";
import School from "../models/school.js";
import Classroom from "../models/classroom.js";
import { sendNewExamEmail } from "../utils/mailer.js";
import SchoolYear from "../models/schoolYear.js";

const router = express.Router();

/* =========================
  HỖ TRỢ NĂM HỌC HIỆN TẠI
  ========================= */
async function getCurrentActiveYear() {
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

/* =========================================================
 *  GET /api/mock-exams
 *  Lấy danh sách đề thi thử (lọc theo scope class/grade riêng)
 * ======================================================= */
router.get("/", verifyToken, async (req, res) => {
  try {
    const {
      examType,
      active,
      schoolId,
      classroomId,
      scope,
      gradeKey,
      status,
      schoolYearId,
      archived,
    } = req.query;

    const {
      role,
      school: userSchool,
      classroom: userClassroom,
      grade: userGrade,
      currentSchoolYear,
    } = req.user;

    const filter = {};
    const isArchivedMode = archived === "true";

    if (isArchivedMode) {
      filter.isArchived = true;
    } else {
      filter.isArchived = { $ne: true };
    }

    // Học sinh không được xem kho lưu trữ
    if (isArchivedMode && role === "student") {
      return res
        .status(403)
        .json({ message: "Học sinh không được xem kho lưu trữ đề thi" });
    }

    if (examType) filter.examType = examType;

    /* ========== ADMIN ========== */
    if (role === "admin") {
      if (active === "true") filter.isActive = true;
      if (schoolId) filter.school = schoolId;
      if (classroomId) filter.classroom = classroomId;
      if (scope) filter.scope = scope;
      if (gradeKey) filter.gradeKey = gradeKey;
      if (status) filter.status = status;

      let yearFilterId = schoolYearId;
      if (!yearFilterId) {
        const currentYear = await getCurrentActiveYear();
        if (currentYear) yearFilterId = currentYear._id;
      }
      if (yearFilterId) filter.schoolYear = yearFilterId;

      const exams = await MockExam.find(filter)
        .sort({ createdAt: -1 })
        .select(
          [
            "name",
            "examType",
            "description",
            "duration",
            "level",
            "tags",
            "slug",
            "grade",
            "year",
            "officialName",
            "totalQuestions",
            "isActive",
            "scope",
            "school",
            "classroom",
            "gradeKey",
            "status",
            "startTime",
            "endTime",
            "schoolYear",
            "createdAt",
            "createdBy",
            "isArchived",
          ].join(" ")
        )
        .populate("school", "name code")
        .populate("classroom", "name code grade")
        .populate("createdBy", "name email")
        .populate("schoolYear", "name isActive startDate endDate")
        .lean();

      return res.json({ exams });
    }

    /* ========== STUDENT ========== */
    if (role === "student") {
      if (!userSchool) {
        return res
          .status(400)
          .json({ message: "Tài khoản học sinh chưa gắn với trường nào" });
      }

      filter.school = userSchool;
      filter.status = "approved";
      filter.isActive = true;

      let yearFilterId = schoolYearId || currentSchoolYear;
      if (!yearFilterId) {
        const currentYear = await getCurrentActiveYear();
        if (currentYear) yearFilterId = currentYear._id;
      }
      if (yearFilterId) filter.schoolYear = yearFilterId;

      const orConditions = [];

      if (userClassroom) {
        // đề theo lớp
        orConditions.push({ scope: "class", classroom: userClassroom });
      }

      if (userGrade) {
        // đề theo khối (gradeKey = khối)
        orConditions.push({ scope: "grade", gradeKey: userGrade });

        // chỉ lớp 12 mới xem được đề THPTQG cả khối
        if (String(userGrade) === "12") {
          orConditions.push({ scope: "grade", gradeKey: "thptqg" });
        }
      }

      if (orConditions.length > 0) {
        filter.$or = orConditions;
      }

      const exams = await MockExam.find(filter)
        .sort({ createdAt: -1 })
        .select(
          [
            "name",
            "examType",
            "description",
            "duration",
            "level",
            "tags",
            "slug",
            "grade",
            "year",
            "officialName",
            "totalQuestions",
            "isActive",
            "scope",
            "school",
            "classroom",
            "gradeKey",
            "status",
            "startTime",
            "endTime",
            "schoolYear",
            "createdAt",
            "createdBy",
            "isArchived",
          ].join(" ")
        )
        .populate("school", "name code")
        .populate("classroom", "name code grade")
        .populate("createdBy", "name email")
        .populate("schoolYear", "name isActive startDate endDate")
        .lean();

      return res.json({ exams });
    }

    /* ========== TEACHER / SCHOOL_MANAGER / KHÁC ========== */
    if (!userSchool) {
      return res
        .status(400)
        .json({ message: "Tài khoản chưa gắn với trường nào" });
    }

    filter.school = userSchool;

    let yearFilterId = schoolYearId || currentSchoolYear;
    if (!yearFilterId) {
      const currentYear = await getCurrentActiveYear();
      if (currentYear) yearFilterId = currentYear._id;
    }
    if (yearFilterId) filter.schoolYear = yearFilterId;

    if (active === "true") filter.isActive = true;
    if (classroomId) filter.classroom = classroomId;
    if (scope) filter.scope = scope;
    if (gradeKey) filter.gradeKey = gradeKey;
    if (status) filter.status = status;

    const exams = await MockExam.find(filter)
      .sort({ createdAt: -1 })
      .select(
        [
          "name",
          "examType",
          "description",
          "duration",
          "level",
          "tags",
          "slug",
          "grade",
          "year",
          "officialName",
          "totalQuestions",
          "isActive",
          "scope",
          "school",
          "classroom",
          "gradeKey",
          "status",
          "startTime",
          "endTime",
          "schoolYear",
          "createdAt",
          "createdBy",
          "isArchived",
        ].join(" ")
      )
      .populate("school", "name code")
      .populate("classroom", "name code grade")
      .populate("createdBy", "name email")
      .populate("schoolYear", "name isActive startDate endDate")
      .lean();

    res.json({ exams });
  } catch (err) {
    console.error("GET /mock-exams error:", err);
    res
      .status(500)
      .json({ message: "Lỗi server khi lấy danh sách đề thi thử" });
  }
});

/* =========================================================
 *  GET /api/mock-exams/upcoming
 *  Danh sách đề thi thử sắp diễn ra (startTime >= now)
 * ======================================================= */
router.get("/upcoming", verifyToken, async (req, res) => {
  try {
    const {
      examType,
      active,
      schoolId,
      classroomId,
      scope,
      gradeKey,
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

    const now = new Date();
    const filter = {
      startTime: { $gte: now },
      isArchived: { $ne: true },
    };

    if (examType) filter.examType = examType;

    /* ========== ADMIN ========== */
    if (role === "admin") {
      if (active === "true") filter.isActive = true;
      if (schoolId) filter.school = schoolId;
      if (classroomId) filter.classroom = classroomId;
      if (scope) filter.scope = scope;
      if (gradeKey) filter.gradeKey = gradeKey;
      if (status) filter.status = status;

      let yearFilterId = schoolYearId;
      if (!yearFilterId) {
        const currentYear = await getCurrentActiveYear();
        if (currentYear) yearFilterId = currentYear._id;
      }
      if (yearFilterId) filter.schoolYear = yearFilterId;

      const exams = await MockExam.find(filter)
        .sort({ startTime: 1, createdAt: -1 })
        .select(
          [
            "name",
            "examType",
            "description",
            "duration",
            "level",
            "tags",
            "slug",
            "grade",
            "year",
            "officialName",
            "totalQuestions",
            "isActive",
            "scope",
            "school",
            "classroom",
            "gradeKey",
            "status",
            "startTime",
            "endTime",
            "schoolYear",
            "createdAt",
            "createdBy",
            "isArchived",
          ].join(" ")
        )
        .populate("school", "name code")
        .populate("classroom", "name code grade")
        .populate("createdBy", "name email")
        .populate("schoolYear", "name isActive startDate endDate")
        .lean();

      return res.json({ exams });
    }

    /* ========== STUDENT ========== */
    if (role === "student") {
      if (!userSchool) {
        return res
          .status(400)
          .json({ message: "Tài khoản học sinh chưa gắn với trường nào" });
      }

      filter.school = userSchool;
      filter.status = "approved";
      filter.isActive = true;

      let yearFilterId = schoolYearId || currentSchoolYear;
      if (!yearFilterId) {
        const currentYear = await getCurrentActiveYear();
        if (currentYear) yearFilterId = currentYear._id;
      }
      if (yearFilterId) filter.schoolYear = yearFilterId;

      const orConditions = [];

      if (userClassroom) {
        orConditions.push({ scope: "class", classroom: userClassroom });
      }

      if (userGrade) {
        orConditions.push({ scope: "grade", gradeKey: userGrade });
        if (String(userGrade) === "12") {
          orConditions.push({ scope: "grade", gradeKey: "thptqg" });
        }
      }

      if (orConditions.length > 0) filter.$or = orConditions;

      const exams = await MockExam.find(filter)
        .sort({ startTime: 1, createdAt: -1 })
        .select(
          [
            "name",
            "examType",
            "description",
            "duration",
            "level",
            "tags",
            "slug",
            "grade",
            "year",
            "officialName",
            "totalQuestions",
            "isActive",
            "scope",
            "school",
            "classroom",
            "gradeKey",
            "status",
            "startTime",
            "endTime",
            "schoolYear",
            "createdAt",
            "createdBy",
            "isArchived",
          ].join(" ")
        )
        .populate("school", "name code")
        .populate("classroom", "name code grade")
        .populate("createdBy", "name email")
        .populate("schoolYear", "name isActive startDate endDate")
        .lean();

      return res.json({ exams });
    }

    /* ========== TEACHER / SCHOOL_MANAGER / KHÁC ========== */
    if (!userSchool) {
      return res
        .status(400)
        .json({ message: "Tài khoản chưa gắn với trường nào" });
    }

    filter.school = userSchool;

    let yearFilterId = schoolYearId || currentSchoolYear;
    if (!yearFilterId) {
      const currentYear = await getCurrentActiveYear();
      if (currentYear) yearFilterId = currentYear._id;
    }
    if (yearFilterId) filter.schoolYear = yearFilterId;

    if (active === "true") filter.isActive = true;
    if (classroomId) filter.classroom = classroomId;
    if (scope) filter.scope = scope;
    if (gradeKey) filter.gradeKey = gradeKey;
    if (status) filter.status = status;

    const exams = await MockExam.find(filter)
      .sort({ startTime: 1, createdAt: -1 })
      .select(
        [
          "name",
          "examType",
          "description",
          "duration",
          "level",
          "tags",
          "slug",
          "grade",
          "year",
          "officialName",
          "totalQuestions",
          "isActive",
          "scope",
          "school",
          "classroom",
          "gradeKey",
          "status",
          "startTime",
          "endTime",
          "schoolYear",
          "createdAt",
          "createdBy",
          "isArchived",
        ].join(" ")
      )
      .populate("school", "name code")
      .populate("classroom", "name code grade")
      .populate("createdBy", "name email")
      .populate("schoolYear", "name isActive startDate endDate")
      .lean();

    return res.json({ exams });
  } catch (err) {
    console.error("GET /mock-exams/upcoming error:", err);
    return res
      .status(500)
      .json({ message: "Lỗi server khi lấy danh sách đề thi thử sắp diễn ra" });
  }
});

/* =========================
  META: Năm học hiện tại
  ========================= */
router.get("/meta/current-year", verifyToken, async (req, res) => {
  try {
    const year = await getCurrentActiveYear();
    if (!year) {
      return res
        .status(404)
        .json({ message: "Chưa cấu hình năm học hiện tại (isActive = true)" });
    }

    return res.json({
      schoolYear: {
        _id: year._id,
        name: year.name,
        startDate: year.startDate,
        endDate: year.endDate,
        isActive: year.isActive,
      },
    });
  } catch (err) {
    console.error("GET /mock-exams/meta/current-year error:", err);
    return res
      .status(500)
      .json({ message: "Lỗi server khi lấy năm học hiện tại" });
  }
});

/* =========================================================
 *  GET /api/mock-exams/:idOrSlug
 *  Chi tiết 1 đề thi thử (phân quyền class vs grade)
 * ======================================================= */
router.get("/:idOrSlug", verifyToken, async (req, res) => {
  try {
    const { idOrSlug } = req.params;
    let exam = null;

    if (mongoose.Types.ObjectId.isValid(idOrSlug)) {
      exam = await MockExam.findById(idOrSlug)
        .populate({
          path: "questions",
          select: "content type options answer skill grade level subQuestions",
        })
        .populate("school", "name code")
        .populate("classroom", "name grade")
        .populate("createdBy", "name email")
        .populate("schoolYear", "name isActive startDate endDate")
        .lean();
    }

    if (!exam) {
      exam = await MockExam.findOne({ slug: idOrSlug })
        .populate({
          path: "questions",
          select: "content type options answer skill grade level subQuestions",
        })
        .populate("school", "name code")
        .populate("classroom", "name grade")
        .populate("createdBy", "name email")
        .populate("schoolYear", "name isActive startDate endDate")
        .lean();
    }

    if (!exam) {
      return res.status(404).json({ message: "Không tìm thấy đề thi thử" });
    }

    const {
      role,
      school: userSchool,
      classroom: userClassroom,
      grade: userGrade,
    } = req.user;

    const examSchoolId =
      exam.school && exam.school._id ? exam.school._id : exam.school;

    if (role !== "admin") {
      if (!userSchool || String(examSchoolId) !== String(userSchool)) {
        return res
          .status(403)
          .json({ message: "Không có quyền xem đề thi thử của trường khác" });
      }
    }

    if (role === "student") {
      if (exam.isArchived) {
        return res.status(403).json({
          message: "Đề thi thử này đã được lưu trữ, không thể làm.",
        });
      }
      if (exam.status !== "approved" || exam.isActive === false) {
        return res
          .status(403)
          .json({ message: "Đề thi thử chưa được duyệt hoặc đã bị khóa" });
      }

      if (exam.startTime && new Date(exam.startTime) > new Date()) {
        return res.status(403).json({
          message: "Đề thi này chưa đến giờ làm. Vui lòng quay lại sau.",
        });
      }

      let allowed = false;

      if (exam.scope === "class") {
        const examClassroomId =
          exam.classroom && exam.classroom._id
            ? exam.classroom._id
            : exam.classroom;
        if (examClassroomId && userClassroom) {
          allowed = String(examClassroomId) === String(userClassroom);
        }
      } else if (exam.scope === "grade") {
        if (exam.gradeKey && userGrade) {
          if (exam.gradeKey === userGrade) {
            allowed = true;
          }
          if (!allowed && exam.gradeKey === "thptqg" && String(userGrade) === "12") {
            allowed = true;
          }
        }
      }

      if (!allowed) {
        return res.status(403).json({
          message:
            "Bạn không được phép làm đề thi thử này (không đúng lớp hoặc khối trong trường của bạn)",
        });
      }
    }

    const examWithQuestions = {
      ...exam,
      questions: exam.questions || [],
    };

    res.json({ exam: examWithQuestions });
  } catch (err) {
    console.error("GET /mock-exams/:idOrSlug error:", err);
    res
      .status(500)
      .json({ message: "Lỗi server khi lấy chi tiết đề thi thử" });
  }
});

/* =========================================================
 *  POST /api/mock-exams
 *  Tạo đề thi thử mới: scope = "class" | "grade"
 * ======================================================= */
router.post(
  "/",
  verifyToken,
  verifyRole(["admin", "teacher", "school_manager"]),
  async (req, res) => {
    try {
      let {
        name,
        examType,
        description,
        duration,
        level,
        grade,
        skill,
        year,
        officialName,
        questions,
        tags,
        startTime,
        endTime,
        slug,
        scope, // "class" | "grade"
        schoolId,
        classroomId,
        gradeKey, // "6".."12", "thptqg"
      } = req.body;

      const currentYear = await requireCurrentActiveYear(res);
      if (!currentYear) return;

      if (!name || !examType || !duration) {
        return res.status(400).json({
          message: "Thiếu name / examType / duration",
        });
      }

      const role = (req.user.role || "").toLowerCase();

      /* 1. XÁC ĐỊNH SCOPE THEO ROLE */
      let finalScope;
      if (role === "teacher") {
        finalScope = "class";
      } else {
        finalScope = scope === "grade" ? "grade" : "class";
      }

      /* 2. XÁC ĐỊNH TRƯỜNG THEO ROLE */
      let finalSchoolId = schoolId;

      if (role === "admin") {
        if (!finalSchoolId) {
          return res
            .status(400)
            .json({ message: "Cần chọn trường cho đề thi thử" });
        }
      } else if (role === "school_manager" || role === "teacher") {
        if (!req.user.school) {
          return res
            .status(400)
            .json({ message: "Tài khoản chưa gắn với trường nào" });
        }
        if (finalSchoolId && String(finalSchoolId) !== String(req.user.school)) {
          return res
            .status(403)
            .json({ message: "Không được tạo đề thi thử cho trường khác" });
        }
        finalSchoolId = req.user.school;
      }

      const school = await School.findById(finalSchoolId);
      if (!school) {
        return res.status(400).json({ message: "Trường không tồn tại" });
      }

      /* 3. XỬ LÝ LỚP / GRADEKEY RIÊNG BIỆT */
      let finalClassroomId = null;
      let finalGradeKey = gradeKey || null;

      if (role === "teacher") {
        // giáo viên: bắt buộc chọn lớp + lớp phải thuộc trường + là GVCN
        if (!classroomId) {
          return res
            .status(400)
            .json({ message: "Giáo viên cần chọn lớp phụ trách để tạo đề" });
        }

        const classroom = await Classroom.findById(classroomId);
        if (!classroom) {
          return res
            .status(400)
            .json({ message: "Lớp được chọn không tồn tại" });
        }

        if (String(classroom.school) !== String(school._id)) {
          return res.status(400).json({
            message: "Lớp này không thuộc trường của bạn",
          });
        }

        const teacherId = req.user.id || req.user._id;
        if (
          !classroom.homeroomTeacher ||
          String(classroom.homeroomTeacher) !== String(teacherId)
        ) {
          return res.status(403).json({
            message: "Bạn chỉ được tạo đề thi thử cho lớp mình phụ trách",
          });
        }

        finalClassroomId = classroomId;
        if (!finalGradeKey && classroom.grade) {
          finalGradeKey = String(classroom.grade);
        }
      } else if (finalScope === "class") {
        // admin / school_manager với scope class
        if (!classroomId) {
          return res
            .status(400)
            .json({ message: "Cần chọn lớp cho đề áp dụng theo lớp" });
        }

        const classroom = await Classroom.findById(classroomId);
        if (!classroom) {
          return res.status(400).json({ message: "Lớp không tồn tại" });
        }

        if (String(classroom.school) !== String(school._id)) {
          return res
            .status(400)
            .json({ message: "Lớp này không thuộc trường đã chọn" });
        }

        finalClassroomId = classroomId;
        if (!finalGradeKey && classroom.grade) {
          finalGradeKey = String(classroom.grade);
        }
      } else {
        // scope = grade (admin + school_manager)
        if (!finalGradeKey) {
          return res.status(400).json({
            message: "Cần gradeKey (VD: '6') cho đề áp dụng theo khối",
          });
        }
      }

      /* 4. CHUẨN HOÁ DANH SÁCH CÂU HỎI */
      let questionIdsRaw = questions;

      if (typeof questionIdsRaw === "string") {
        try {
          questionIdsRaw = JSON.parse(questionIdsRaw);
        } catch (e) {
          return res.status(400).json({
            message:
              "Field 'questions' đang là string, không parse được JSON. Hãy gửi mảng ID câu hỏi.",
          });
        }
      }

      if (!Array.isArray(questionIdsRaw) || questionIdsRaw.length === 0) {
        return res
          .status(400)
          .json({ message: "Đề thi phải có ít nhất 1 câu hỏi" });
      }

      const questionIds = questionIdsRaw.map((q) =>
        typeof q === "string" ? q : q?._id
      );

      const invalidIds = questionIds.filter(
        (id) => !mongoose.Types.ObjectId.isValid(id)
      );
      if (invalidIds.length) {
        return res.status(400).json({
          message: "Một số ID câu hỏi không hợp lệ",
          invalidIds,
        });
      }

      /* 5. SLUG + TRẠNG THÁI DUYỆT */
      let finalSlug = slug;
      if (!finalSlug) {
        finalSlug =
          name
            .toLowerCase()
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "")
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/(^-|-$)+/g, "") +
          "-" +
          Date.now().toString(36);
      }

      let status = "pending";
      if (role === "admin" || role === "school_manager") {
        status = "approved";
      }

      /* 6. TẠO ĐỀ THI */
      const exam = await MockExam.create({
        name,
        examType,
        description,
        duration,
        level: level || "mixed",
        grade,
        skill: skill || "mixed",
        year,
        officialName,
        tags,
        startTime,
        endTime,
        slug: finalSlug,
        questions: questionIds,
        totalQuestions: questionIds.length,
        createdBy: req.user._id,

        scope: finalScope,
        school: finalSchoolId,
        classroom: finalScope === "class" ? finalClassroomId : null,
        gradeKey: finalGradeKey,
        schoolYear: currentYear._id,
        status,
        approvedBy: status === "approved" ? req.user._id : undefined,
        approvedAt: status === "approved" ? new Date() : undefined,
        rejectReason: "",
        isArchived: false,
      });

      const io = req.app.get("io");
      if (io && exam.status === "pending") {
        io.to("exam-moderators").emit("exam:pending-updated", {
          kind: "mock",
          examId: exam._id.toString(),
          action: "created",
          status: exam.status,
          schoolId: exam.school,
          classroomId: exam.classroom,
        });
      }

      res.status(201).json({ exam });
    } catch (err) {
      console.error("POST /mock-exams error:", err);
      if (err.code === 11000 && err.keyPattern?.slug) {
        return res
          .status(400)
          .json({ message: "Slug đã tồn tại, vui lòng đổi slug khác" });
      }
      res.status(500).json({ message: "Lỗi server khi tạo đề thi thử" });
    }
  }
);

/* =========================================================
 *  PUT /api/mock-exams/:id
 *  Cập nhật đề thi: scope + schoolId + classroomId + gradeKey
 * ======================================================= */
router.put(
  "/:id",
  verifyToken,
  verifyRole(["admin", "teacher", "school_manager"]),
  async (req, res) => {
    try {
      const { id } = req.params;
      let {
        name,
        examType,
        description,
        duration,
        level,
        grade,
        skill,
        year,
        officialName,
        tags,
        startTime,
        endTime,
        slug,
        questions,
        isActive,
        scope,
        schoolId,
        classroomId,
        gradeKey,
      } = req.body;

      const exam = await MockExam.findById(id);
      if (!exam) {
        return res.status(404).json({ message: "Không tìm thấy đề thi thử" });
      }

      // hạn chế theo trường cho school_manager & teacher
      if (req.user.role !== "admin") {
        if (!req.user.school || String(exam.school) !== String(req.user.school)) {
          return res
            .status(403)
            .json({ message: "Không có quyền sửa đề thi thử của trường khác" });
        }
      }

      const update = {
        name,
        examType,
        description,
        duration,
        level,
        grade,
        skill,
        year,
        officialName,
        tags,
        startTime,
        endTime,
        slug,
        isActive,
      };

      /* Cập nhật phạm vi nếu FE gửi */
      if (typeof scope !== "undefined" || schoolId || classroomId || gradeKey) {
        const role = (req.user.role || "").toLowerCase();
        let finalScope = scope === "grade" ? "grade" : "class";

        if (role === "teacher") {
          finalScope = "class";
        }

        let finalSchoolId = schoolId || exam.school;

        if (role === "admin") {
          if (!finalSchoolId) {
            return res.status(400).json({
              message: "Cần chọn trường khi cập nhật phạm vi đề",
            });
          }
        } else {
          if (!req.user.school) {
            return res
              .status(400)
              .json({ message: "Tài khoản chưa gắn với trường nào" });
          }
          if (finalSchoolId && String(finalSchoolId) !== String(req.user.school)) {
            return res
              .status(403)
              .json({ message: "Không được cập nhật đề thi thử sang trường khác" });
          }
          finalSchoolId = req.user.school;
        }

        const school = await School.findById(finalSchoolId);
        if (!school) {
          return res.status(400).json({ message: "Trường không tồn tại" });
        }

        let finalGradeKey = gradeKey || exam.gradeKey || null;

        if (finalScope === "class") {
          const finalClassroomId = classroomId || exam.classroom;

          if (!finalClassroomId) {
            return res.status(400).json({
              message: "Cần chọn lớp cho đề áp dụng theo lớp",
            });
          }

          const classroom = await Classroom.findById(finalClassroomId);
          if (!classroom) {
            return res.status(400).json({ message: "Lớp không tồn tại" });
          }

          if (String(classroom.school) !== String(school._id)) {
            return res.status(400).json({
              message: "Lớp này không thuộc trường đã chọn",
            });
          }

          // nếu teacher: lớp phải do giáo viên phụ trách
          if (role === "teacher") {
            const teacherId = req.user.id || req.user._id;
            if (
              !classroom.homeroomTeacher ||
              String(classroom.homeroomTeacher) !== String(teacherId)
            ) {
              return res.status(403).json({
                message: "Bạn chỉ được cập nhật đề thi thử của lớp mình phụ trách",
              });
            }
          }

          if (!finalGradeKey && classroom.grade) {
            finalGradeKey = String(classroom.grade);
          }

          update.classroom = finalClassroomId;
        } else {
          // scope = grade
          if (!finalGradeKey) {
            return res.status(400).json({
              message: "Cần gradeKey cho đề áp dụng theo khối",
            });
          }
          update.classroom = null;
        }

        update.scope = finalScope;
        update.school = finalSchoolId;
        update.gradeKey = finalGradeKey;
      }

      // cập nhật câu hỏi nếu gửi
      if (typeof questions !== "undefined") {
        let questionIdsRaw = questions;

        if (typeof questionIdsRaw === "string") {
          try {
            questionIdsRaw = JSON.parse(questionIdsRaw);
          } catch (e) {
            return res.status(400).json({
              message:
                "Field 'questions' đang là string, không parse được JSON. Hãy gửi mảng ID câu hỏi.",
            });
          }
        }

        if (!Array.isArray(questionIdsRaw)) {
          return res.status(400).json({
            message: "Field 'questions' phải là mảng ID câu hỏi",
          });
        }

        const questionIds = questionIdsRaw.map((q) =>
          typeof q === "string" ? q : q?._id
        );

        const invalidIds = questionIds.filter(
          (id2) => !mongoose.Types.ObjectId.isValid(id2)
        );
        if (invalidIds.length) {
          return res.status(400).json({
            message: "Một số ID câu hỏi không hợp lệ",
            invalidIds,
          });
        }

        update.questions = questionIds;
        update.totalQuestions = questionIds.length;
      }

      const updated = await MockExam.findByIdAndUpdate(id, update, {
        new: true,
      }).lean();

      if (!updated) {
        return res.status(404).json({ message: "Không tìm thấy đề thi thử" });
      }

      const io = req.app.get("io");
      if (io) {
        io.to("exam-moderators").emit("exam:pending-updated", {
          kind: "mock",
          examId: updated._id.toString(),
          action: "updated",
          status: updated.status,
          schoolId: updated.school,
          classroomId: updated.classroom,
        });
      }

      res.json({ exam: updated });
    } catch (err) {
      console.error("PUT /mock-exams/:id error:", err);
      res
        .status(500)
        .json({ message: "Lỗi server khi cập nhật đề thi thử" });
    }
  }
);

/* =========================================================
 *  POST /api/mock-exams/auto-generate
 *  Tạo đề thi thử tự động + scope class / grade
 * ======================================================= */
router.post(
  "/auto-generate",
  verifyToken,
  verifyRole(["admin", "teacher", "school_manager"]),
  async (req, res) => {
    try {
      const {
        gradeKey,
        name,
        totalQuestions,
        duration,
        level = "mixed",
        scope,
        schoolId,
        classroomId,
        startTime,
        endTime,
      } = req.body;

      const currentYear = await requireCurrentActiveYear(res);
      if (!currentYear) return;

      if (!gradeKey) {
        return res.status(400).json({
          message:
            "Thiếu gradeKey (ví dụ: '6','7',...,'12','thptqg','ielts','toeic','vstep')",
        });
      }

      const role = (req.user.role || "").toLowerCase();

      /* 1. SCOPE THEO ROLE */
      let finalScope;
      if (role === "teacher") {
        finalScope = "class";
      } else {
        finalScope = scope === "grade" ? "grade" : "class";
      }

      /* 2. TRƯỜNG THEO ROLE */
      let finalSchoolId = schoolId;

      if (role === "admin") {
        if (!finalSchoolId) {
          return res.status(400).json({
            message: "Cần chọn trường cho đề thi thử tự động",
          });
        }
      } else if (role === "school_manager" || role === "teacher") {
        if (!req.user.school) {
          return res
            .status(400)
            .json({ message: "Tài khoản chưa gắn với trường nào" });
        }

        if (finalSchoolId && String(finalSchoolId) !== String(req.user.school)) {
          return res
            .status(403)
            .json({ message: "Không được tạo đề thi thử cho trường khác" });
        }

        finalSchoolId = req.user.school;
      }

      const school = await School.findById(finalSchoolId);
      if (!school) {
        return res.status(400).json({ message: "Trường không tồn tại" });
      }

      /* 3. LỚP THEO ROLE / SCOPE */
      let finalClassroomId = null;

      if (role === "teacher") {
        if (!classroomId) {
          return res.status(400).json({
            message: "Giáo viên cần chọn lớp phụ trách để tạo đề thi thử tự động",
          });
        }

        const classroom = await Classroom.findById(classroomId);
        if (!classroom) {
          return res.status(400).json({ message: "Lớp được chọn không tồn tại" });
        }

        if (String(classroom.school) !== String(school._id)) {
          return res.status(400).json({
            message: "Lớp này không thuộc trường của bạn",
          });
        }

        const teacherId = req.user.id || req.user._id;
        if (
          !classroom.homeroomTeacher ||
          String(classroom.homeroomTeacher) !== String(teacherId)
        ) {
          return res.status(403).json({
            message: "Bạn chỉ được tạo đề thi thử tự động cho lớp mình phụ trách",
          });
        }

        finalClassroomId = classroomId;
      } else if (finalScope === "class") {
        if (!classroomId) {
          return res.status(400).json({
            message: "Cần chọn lớp cho đề áp dụng theo lớp",
          });
        }

        const classroom = await Classroom.findById(classroomId);
        if (!classroom) {
          return res.status(400).json({ message: "Lớp không tồn tại" });
        }

        if (String(classroom.school) !== String(school._id)) {
          return res.status(400).json({
            message: "Lớp này không thuộc trường đã chọn",
          });
        }

        finalClassroomId = classroomId;
      }
      // scope = grade (admin + school_manager): không cần classroomId

      /* 4. MAP gradeKey -> Question.grade + MockExam.grade + examType */
      let questionGrade = "";
      let examType = "thptqg";
      let mockExamGrade = "";

      if (["6", "7", "8", "9", "10", "11", "12"].includes(gradeKey)) {
        questionGrade = gradeKey;
        mockExamGrade = `Lớp ${gradeKey}`;
        examType = "thptqg";
      } else if (gradeKey === "thptqg") {
        questionGrade = "thptqg";
        mockExamGrade = "thptqg";
        examType = "thptqg";
      } else if (["ielts", "toeic", "vstep"].includes(gradeKey)) {
        questionGrade = gradeKey;
        mockExamGrade = gradeKey.toUpperCase();
        examType = gradeKey;
      } else {
        return res.status(400).json({
          message:
            "gradeKey không hợp lệ. Hỗ trợ: '6'..'12', 'thptqg', 'ielts', 'toeic', 'vstep'.",
        });
      }

      const targetQuestions = Number(totalQuestions) || 40;

      let examDuration = 60;
      const d = Number(duration);
      if (Number.isFinite(d) && d > 0) examDuration = d;

      const questionFilter = { grade: questionGrade };
      if (["easy", "medium", "hard"].includes(level)) {
        questionFilter.level = level;
      }

      const allQuestions = await Question.find(questionFilter).select(
        "_id skill"
      );

      if (!allQuestions.length) {
        return res.status(400).json({
          message: `Không tìm thấy câu hỏi nào cho grade = ${questionGrade}`,
        });
      }

      const groups = {
        reading: [],
        listening: [],
        writing: [],
        speaking: [],
        other: [],
      };

      allQuestions.forEach((q) => {
        const sk = (q.skill || "").toLowerCase();
        if (sk === "reading") groups.reading.push(q._id);
        else if (sk === "listening") groups.listening.push(q._id);
        else if (sk === "writing") groups.writing.push(q._id);
        else if (sk === "speaking") groups.speaking.push(q._id);
        else groups.other.push(q._id);
      });

      const shuffle = (arr) => {
        const a = [...arr];
        for (let i = a.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [a[i], a[j]] = [a[j], a[i]];
        }
        return a;
      };

      const skillsOrder = ["reading", "listening", "writing", "speaking"];
      const basePerSkill = Math.floor(targetQuestions / 4);

      const picked = [];
      const leftovers = [];

      for (const sk of skillsOrder) {
        const pool = shuffle(groups[sk]);
        const take = Math.min(basePerSkill, pool.length);
        picked.push(...pool.slice(0, take));
        leftovers.push(...pool.slice(take));
      }

      leftovers.push(...shuffle(groups.other));

      let needMore = targetQuestions - picked.length;
      if (needMore > 0) {
        picked.push(...leftovers.slice(0, needMore));
      }

      const uniquePicked = Array.from(new Set(picked));
      if (!uniquePicked.length) {
        return res.status(400).json({
          message: "Không đủ câu hỏi để tạo đề thi thử tự động",
        });
      }

      const now = new Date();
      const shortTs = now.getTime().toString(36);

      const defaultName =
        gradeKey === "thptqg"
          ? `Đề thi thử THPTQG (tự động) - ${shortTs}`
          : ["ielts", "toeic", "vstep"].includes(gradeKey)
          ? `Đề thi thử ${gradeKey.toUpperCase()} (tự động) - ${shortTs}`
          : `Đề thi thử Lớp ${gradeKey} (tự động) - ${shortTs}`;

      const finalName = (name && name.trim()) || defaultName;

      const slug =
        finalName
          .toLowerCase()
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "")
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/(^-|-$)+/g, "") +
        "-" +
        shortTs;

      let status = "pending";
      if (role === "admin" || role === "school_manager") {
        status = "approved";
      }

      const exam = await MockExam.create({
        name: finalName,
        examType,
        description: `Đề thi thử tự động cho ${mockExamGrade}, gồm ${uniquePicked.length} câu hỏi đủ 4 kỹ năng.`,
        duration: examDuration,
        level,
        grade: mockExamGrade,
        skill: "mixed",
        totalQuestions: uniquePicked.length,
        slug,
        questions: uniquePicked,
        createdBy: req.user._id,

        scope: finalScope,
        school: finalSchoolId,
        classroom: finalScope === "class" ? finalClassroomId : null,
        gradeKey: gradeKey,
        startTime: startTime || undefined,
        endTime: endTime || undefined,
        schoolYear: currentYear._id,
        status,
        approvedBy: status === "approved" ? req.user._id : undefined,
        approvedAt: status === "approved" ? new Date() : undefined,
        rejectReason: "",
        isArchived: false,
      });

      const io = req.app.get("io");
      if (io && exam.status === "pending") {
        io.to("exam-moderators").emit("exam:pending-updated", {
          kind: "mock",
          examId: exam._id.toString(),
          action: "created",
          status: exam.status,
          schoolId: exam.school,
          classroomId: exam.classroom,
        });
      }

      // gửi mail
      try {
        const studentFilter = { role: "student" };

        if (finalScope === "class" && finalClassroomId) {
          studentFilter.classroom = finalClassroomId;
        } else if (finalScope === "grade" && finalSchoolId) {
          studentFilter.school = finalSchoolId;
        }

        const students = await User.find(studentFilter).select("email name");

        const examLink = process.env.CLIENT_URL
          ? `${process.env.CLIENT_URL}/mock-exams/${exam._id}`
          : "";

        await Promise.all(
          students
            .filter((s) => !!s.email)
            .map((s) =>
              sendNewExamEmail({
                to: s.email,
                studentName: s.name,
                examTitle: exam.name,
                duration: exam.duration,
                examLink,
              })
            )
        );
      } catch (mailErr) {
        console.error("Lỗi gửi mail thông báo đề thi thử mới:", mailErr);
      }

      return res.status(201).json({ exam });
    } catch (err) {
      console.error("POST /mock-exams/auto-generate error:", err);
      return res
        .status(500)
        .json({ message: "Lỗi server khi tạo đề thi thử tự động" });
    }
  }
);

/* =========================================================
 *  PATCH /api/mock-exams/:id/approve
 *  Duyệt đề thi thử
 * ======================================================= */
router.patch(
  "/:id/approve",
  verifyToken,
  verifyRole(["admin", "school_manager"]),
  async (req, res) => {
    try {
      const { id } = req.params;

      const exam = await MockExam.findById(id);
      if (!exam) {
        return res.status(404).json({ message: "Không tìm thấy đề thi thử" });
      }

      // school_manager chỉ duyệt trong trường mình
      if (req.user.role !== "admin") {
        if (!req.user.school || String(exam.school) !== String(req.user.school)) {
          return res
            .status(403)
            .json({ message: "Không được duyệt đề thi thử của trường khác" });
        }
      }

      if (exam.status === "approved") {
        return res
          .status(400)
          .json({ message: "Đề thi thử đã được duyệt trước đó" });
      }

      exam.status = "approved";
      exam.approvedBy = req.user._id;
      exam.approvedAt = new Date();
      exam.rejectReason = "";
      await exam.save();

      const io = req.app.get("io");
      if (io) {
        io.to("exam-moderators").emit("exam:pending-updated", {
          kind: "mock",
          examId: exam._id.toString(),
          action: "approved",
          status: exam.status,
          schoolId: exam.school,
          classroomId: exam.classroom,
        });
      }
      res.json({ message: "Duyệt đề thi thử thành công", exam });
    } catch (err) {
      console.error("PATCH /mock-exams/:id/approve error:", err);
      res.status(500).json({ message: "Lỗi server khi duyệt đề thi thử" });
    }
  }
);

/* =========================================================
 *  PATCH /api/mock-exams/:id/reject
 *  Từ chối đề thi thử
 * ======================================================= */
router.patch(
  "/:id/reject",
  verifyToken,
  verifyRole(["admin", "school_manager"]),
  async (req, res) => {
    try {
      const { id } = req.params;
      const { reason } = req.body;

      const exam = await MockExam.findById(id);
      if (!exam) {
        return res.status(404).json({ message: "Không tìm thấy đề thi thử" });
      }

      if (req.user.role !== "admin") {
        if (!req.user.school || String(exam.school) !== String(req.user.school)) {
          return res
            .status(403)
            .json({ message: "Không được từ chối đề thi thử của trường khác" });
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
          kind: "mock",
          examId: exam._id.toString(),
          action: "rejected",
          status: exam.status,
          schoolId: exam.school,
          classroomId: exam.classroom,
        });
      }
      res.json({ message: "Đã từ chối đề thi thử", exam });
    } catch (err) {
      console.error("PATCH /mock-exams/:id/reject error:", err);
      res.status(500).json({ message: "Lỗi server khi từ chối đề thi thử" });
    }
  }
);

/* =========================================================
 *  PATCH /api/mock-exams/:id/archive
 *  Chuyển đề thi vào kho lưu trữ
 * ======================================================= */
router.patch(
  "/:id/archive",
  verifyToken,
  verifyRole(["admin", "school_manager"]),
  async (req, res) => {
    try {
      const { id } = req.params;

      const exam = await MockExam.findById(id);
      if (!exam) {
        return res.status(404).json({ message: "Không tìm thấy đề thi thử" });
      }

      if (req.user.role !== "admin") {
        if (!req.user.school || String(exam.school) !== String(req.user.school)) {
          return res
            .status(403)
            .json({ message: "Không được lưu trữ đề thi thử của trường khác" });
        }
      }

      if (exam.isArchived) {
        return res
          .status(400)
          .json({ message: "Đề thi thử đã ở trong kho lưu trữ" });
      }

      exam.isArchived = true;
      exam.isActive = false;
      exam.archivedAt = new Date();
      exam.archivedBy = req.user._id;

      await exam.save();

      const io = req.app.get("io");
      if (io) {
        io.to("exam-moderators").emit("exam:pending-updated", {
          kind: "mock",
          examId: exam._id.toString(),
          action: "archived",
          status: exam.status,
          schoolId: exam.school,
          classroomId: exam.classroom,
        });
      }

      return res.json({
        message: "Đã chuyển đề thi thử vào kho lưu trữ",
        exam,
      });
    } catch (err) {
      console.error("PATCH /mock-exams/:id/archive error:", err);
      return res
        .status(500)
        .json({ message: "Lỗi server khi lưu trữ đề thi thử" });
    }
  }
);

/* =========================================================
 *  PATCH /api/mock-exams/:id/restore
 *  Khôi phục đề thi từ kho lưu trữ
 * ======================================================= */
router.patch(
  "/:id/restore",
  verifyToken,
  verifyRole(["admin", "school_manager"]),
  async (req, res) => {
    try {
      const { id } = req.params;
      const { schoolYearId } = req.body || {};

      const exam = await MockExam.findById(id);
      if (!exam) {
        return res.status(404).json({ message: "Không tìm thấy đề thi thử" });
      }

      if (req.user.role !== "admin") {
        if (!req.user.school || String(exam.school) !== String(req.user.school)) {
          return res
            .status(403)
            .json({ message: "Không được khôi phục đề thi thử của trường khác" });
        }
      }

      if (!exam.isArchived) {
        return res.status(400).json({
          message: "Đề thi thử hiện không nằm trong kho lưu trữ",
        });
      }

      let targetYear = null;

      if (schoolYearId) {
        targetYear = await SchoolYear.findById(schoolYearId);
        if (!targetYear) {
          return res
            .status(400)
            .json({ message: "Năm học khôi phục không tồn tại" });
        }
      } else {
        targetYear = await requireCurrentActiveYear(res);
        if (!targetYear) return;
      }

      exam.isArchived = false;
      exam.archivedAt = undefined;
      exam.archivedBy = undefined;
      exam.schoolYear = targetYear._id;
      exam.isActive = true;

      await exam.save();

      const io = req.app.get("io");
      if (io) {
        io.to("exam-moderators").emit("exam:pending-updated", {
          kind: "mock",
          examId: exam._id.toString(),
          action: "restored",
          status: exam.status,
          schoolId: exam.school,
          classroomId: exam.classroom,
        });
      }

      return res.json({
        message: "Đã khôi phục đề thi thử từ kho lưu trữ",
        exam,
      });
    } catch (err) {
      console.error("PATCH /mock-exams/:id/restore error:", err);
      return res
        .status(500)
        .json({ message: "Lỗi server khi khôi phục đề thi thử" });
    }
  }
);

/* =========================================================
 *  DELETE /api/mock-exams/:idOrSlug
 *  Xoá vĩnh viễn: chỉ khi đang ở trạng thái lưu trữ
 * ======================================================= */
router.delete(
  "/:idOrSlug",
  verifyToken,
  verifyRole(["admin", "school_manager"]),
  async (req, res) => {
    try {
      const { idOrSlug } = req.params;

      let exam = null;

      if (mongoose.Types.ObjectId.isValid(idOrSlug)) {
        exam = await MockExam.findById(idOrSlug);
      } else {
        exam = await MockExam.findOne({ slug: idOrSlug });
      }

      if (!exam) {
        return res.status(404).json({ message: "Không tìm thấy đề thi thử" });
      }

      if (req.user.role !== "admin") {
        if (!req.user.school || String(exam.school) !== String(req.user.school)) {
          return res
            .status(403)
            .json({ message: "Không được xóa đề thi thử của trường khác" });
        }
      }

      if (!exam.isArchived) {
        return res.status(400).json({
          message:
            "Chỉ được xóa vĩnh viễn đề thi đã chuyển vào kho lưu trữ. Vui lòng lưu trữ trước.",
        });
      }

      await exam.deleteOne();

      const io = req.app.get("io");
      if (io) {
        io.to("exam-moderators").emit("exam:pending-updated", {
          kind: "mock",
          examId: exam._id.toString(),
          action: "deleted",
          status: exam.status,
          schoolId: exam.school,
          classroomId: exam.classroom,
        });
      }

      return res.json({ message: "Đã xóa vĩnh viễn đề thi thử", exam });
    } catch (err) {
      console.error("DELETE /mock-exams/:idOrSlug error:", err);
      return res
        .status(500)
        .json({ message: "Lỗi server khi xóa đề thi thử" });
    }
  }
);

export default router;
