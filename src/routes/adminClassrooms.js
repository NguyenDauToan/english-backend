// src/routes/adminClassrooms.js
import express from "express";
import mongoose from "mongoose";
import Classroom from "../models/classroom.js";
import School from "../models/school.js";
import User from "../models/user.js";
import SchoolYear from "../models/schoolYear.js";
import { verifyToken, verifyRole } from "../middleware/auth.js";
import ClassroomHistory from "../models/classroomHistory.js";

const router = express.Router();

/* ====== HỖ TRỢ: auto copy lớp từ năm đã kết thúc sang năm hiện tại ====== */
async function ensureClassesForCurrentYear(currentYear, schoolFilter) {
  if (!currentYear) return;

  // năm đã kết thúc gần nhất
  const lastEndedYear = await SchoolYear.findOne({ isActive: false }).sort({
    endDate: -1,
  });
  if (!lastEndedYear) return;

  // nếu năm hiện tại đã có lớp rồi thì thôi
  const currentFilter = { schoolYear: currentYear._id };
  if (schoolFilter) {
    currentFilter.school = schoolFilter;
  }

  const existingCount = await Classroom.countDocuments(currentFilter);
  if (existingCount > 0) return;

  // lấy lớp từ năm đã kết thúc gần nhất
  const prevFilter = { schoolYear: lastEndedYear._id };
  if (schoolFilter) {
    prevFilter.school = schoolFilter;
  }

  const prevClasses = await Classroom.find(prevFilter).lean();
  if (!prevClasses.length) return;

  const bulkOps = prevClasses.map((cls) => ({
    insertOne: {
      document: {
        name: cls.name,
        grade: cls.grade,
        school: cls.school,
        schoolYear: currentYear._id, // gán sang năm hiện tại
        homeroomTeacher: cls.homeroomTeacher || undefined,
        // students: []  // để trống, lịch sử vẫn nằm ở lớp của năm cũ
      },
    },
  }));

  await Classroom.bulkWrite(bulkOps);
}

/* ================= PUBLIC: dùng cho màn hình đăng ký =================
 * GET /api/admin/classrooms/public?schoolId=...&grade=...&schoolYearId=...
 */
router.get("/public", async (req, res) => {
  try {
    const { schoolId, grade, schoolYearId } = req.query;

    // phải có schoolId
    if (!schoolId) {
      return res.json({ classrooms: [] });
    }
    if (!mongoose.Types.ObjectId.isValid(schoolId)) {
      return res.status(400).json({ message: "schoolId không hợp lệ" });
    }

    const filter = { school: schoolId };

    if (grade) filter.grade = grade;

    if (schoolYearId) {
      if (!mongoose.Types.ObjectId.isValid(schoolYearId)) {
        return res.status(400).json({ message: "schoolYearId không hợp lệ" });
      }
      filter.schoolYear = schoolYearId;
    }

    const classrooms = await Classroom.find(filter)
      .select("name grade school schoolYear")
      .populate("school", "name code")
      .populate({
        path: "schoolYear",
        select: "name isActive endDate",
        match: { isActive: true }, // chỉ lấy năm học còn active
      })
      .lean();

    res.json({ classrooms });
  } catch (err) {
    console.error("Lỗi khi lấy danh sách lớp (public):", err);
    res.status(500).json({ message: "Server error" });
  }
});

/* ============================================================
 * GET /api/admin/classrooms?schoolId=...&grade=...&schoolYearId=...
 * ==========================================================*/
router.get(
  "/",
  verifyToken,
  verifyRole(["admin", "school_manager", "teacher", "student"]),
  async (req, res) => {
    try {
      const { schoolId, grade, schoolYearId ,includeStudents } = req.query;
      const role = req.user.role;
      const filter = {};

      // ---- lọc theo trường theo role ----
      if (role === "admin") {
        if (schoolId) {
          if (!mongoose.Types.ObjectId.isValid(schoolId)) {
            return res.status(400).json({ message: "schoolId không hợp lệ" });
          }
          filter.school = schoolId;
        }
      } else if (role === "school_manager" || role === "teacher") {
        if (!req.user.school) {
          return res
            .status(403)
            .json({ message: "Tài khoản chưa được gắn với trường nào" });
        }
        filter.school = req.user.school;
      } else if (role === "student") {
        if (schoolId) {
          if (!mongoose.Types.ObjectId.isValid(schoolId)) {
            return res.status(400).json({ message: "schoolId không hợp lệ" });
          }
          filter.school = schoolId;
        } else {
          return res.json({ classrooms: [] });
        }
      }

      if (grade) filter.grade = grade;

      if (schoolYearId) {
        if (!mongoose.Types.ObjectId.isValid(schoolYearId)) {
          return res
            .status(400)
            .json({ message: "schoolYearId không hợp lệ" });
        }
        filter.schoolYear = schoolYearId;
      }

      // ====== XỬ LÝ NĂM HỌC HIỆN TẠI + AUTO COPY LỚP ======
      const currentYear = await SchoolYear.findOne({ isActive: true }).sort({
        startDate: -1,
      });

      if (currentYear) {
        if (!schoolYearId) {
          filter.schoolYear = currentYear._id;
        }

        const requestedYearId = schoolYearId || String(currentYear._id);

        if (String(requestedYearId) === String(currentYear._id)) {
          await ensureClassesForCurrentYear(currentYear, filter.school);
        }
      }

      let query = Classroom.find(filter)
        .populate("school", "name code")
        .populate("homeroomTeacher", "name email role")
        .populate("schoolYear", "name isActive endDate");

      // nếu FE yêu cầu thì populate students
      if (includeStudents === "true") {
        query = query.populate("students", "name email");
      }

      const classrooms = await query.lean();

      res.json({ classrooms });
    } catch (err) {
      console.error("Lỗi khi lấy danh sách lớp:", err);
      res.status(500).json({ message: "Server error" });
    }
  }
);
/* ============================================================
 * GET /api/admin/classrooms/history?schoolYearId=...&schoolId=...&grade=...
 * => trả về lịch sử lớp học từ ClassroomHistory cho các năm đã kết thúc
 * ==========================================================*/
router.get(
  "/history",
  verifyToken,
  verifyRole(["admin", "school_manager", "teacher"]),
  async (req, res) => {
    try {
      const { schoolId, grade, schoolYearId } = req.query;
      const role = req.user.role;
      const filter = {};

      // ---- schoolYearId là bắt buộc khi xem lịch sử ----
      if (!schoolYearId) {
        return res
          .status(400)
          .json({ message: "schoolYearId là bắt buộc khi xem lịch sử lớp học" });
      }
      if (!mongoose.Types.ObjectId.isValid(schoolYearId)) {
        return res.status(400).json({ message: "schoolYearId không hợp lệ" });
      }
      filter.schoolYear = schoolYearId;

      // ---- lọc theo trường theo role ----
      if (role === "admin") {
        if (schoolId) {
          if (!mongoose.Types.ObjectId.isValid(schoolId)) {
            return res.status(400).json({ message: "schoolId không hợp lệ" });
          }
          filter.school = schoolId;
        }
      } else if (role === "school_manager" || role === "teacher") {
        if (!req.user.school) {
          return res
            .status(403)
            .json({ message: "Tài khoản chưa được gắn với trường nào" });
        }
        filter.school = req.user.school;
      }

      if (grade) {
        filter.grade = grade;
      }

      const histories = await ClassroomHistory.find(filter)
        .populate("school", "name code")
        .populate("homeroomTeacher", "name email role")
        .populate("schoolYear", "name isActive endDate")
        .populate("students", "name email")
        .lean();

      // Trả về cùng key "classrooms" để FE dùng chung state / UI
      return res.json({ classrooms: histories });
    } catch (err) {
      console.error("Lỗi khi lấy lịch sử lớp học:", err);
      res.status(500).json({ message: "Server error" });
    }
  }
);
/* ============================================================
 * GET /api/admin/classrooms/stats/by-school?schoolYearId=...
 * (chỉ admin, tuỳ bạn mở rộng cho manager)
 * ==========================================================*/
router.get(
  "/stats/by-school",
  verifyToken,
  verifyRole(["admin"]),
  async (req, res) => {
    try {
      const { schoolYearId } = req.query;

      const match = {};
      if (schoolYearId) {
        if (!mongoose.Types.ObjectId.isValid(schoolYearId)) {
          return res
            .status(400)
            .json({ message: "schoolYearId không hợp lệ" });
        }
        // aggregation không auto-cast, nên dùng ObjectId thật
        match.schoolYear = new mongoose.Types.ObjectId(schoolYearId);
      }

      const stats = await Classroom.aggregate([
        { $match: match },
        {
          $group: {
            _id: "$school",
            classCount: { $sum: 1 },
            studentCount: {
              $sum: { $size: { $ifNull: ["$students", []] } },
            },
          },
        },
        {
          $lookup: {
            from: "schools",
            localField: "_id",
            foreignField: "_id",
            as: "school",
          },
        },
        { $unwind: "$school" },
        {
          $project: {
            _id: 0,
            schoolId: "$school._id",
            schoolName: "$school.name",
            code: "$school.code",
            classCount: 1,
            studentCount: 1,
          },
        },
      ]);

      res.json({ stats });
    } catch (err) {
      console.error("Lỗi khi thống kê lớp theo trường:", err);
      res.status(500).json({ message: "Server error" });
    }
  }
);

/* ============================================================
 * GET /api/admin/classrooms/:id/year-stats
 * => thống kê theo schoolYear dựa trên name + school
 * ==========================================================*/
router.get(
  "/:id/year-stats",
  verifyToken,
  verifyRole(["admin", "school_manager", "teacher"]),
  async (req, res) => {
    try {
      const { id } = req.params;
      if (!mongoose.Types.ObjectId.isValid(id)) {
        return res.status(400).json({ message: "Id lớp không hợp lệ" });
      }

      const cls = await Classroom.findById(id)
        .populate("school", "name code")
        .lean();

      if (!cls) {
        return res.status(404).json({ message: "Không tìm thấy lớp học" });
      }

      // kiểm tra quyền giống route GET /:id
      const role = req.user.role;

      if (role !== "admin") {
        if (!req.user.school) {
          return res
            .status(403)
            .json({ message: "Tài khoản chưa được gắn với trường nào" });
        }

        const classroomSchoolId =
          cls.school?._id?.toString() ||
          (typeof cls.school === "string"
            ? cls.school
            : cls.school?.toString());

        if (
          !classroomSchoolId ||
          classroomSchoolId !== String(req.user.school)
        ) {
          return res.status(403).json({
            message: "Bạn không có quyền xem thống kê lớp thuộc trường khác",
          });
        }
      }

      const stats = await Classroom.aggregate([
        {
          $match: {
            school: cls.school._id,
            name: cls.name,
          },
        },
        {
          $project: {
            schoolYear: 1,
            studentCount: { $size: { $ifNull: ["$students", []] } },
          },
        },
        { $sort: { schoolYear: 1 } },
      ]);

      res.json({
        baseClassName: cls.name,
        school: cls.school,
        stats,
      });
    } catch (err) {
      console.error("Lỗi khi thống kê lớp theo năm học:", err);
      res.status(500).json({ message: "Server error" });
    }
  }
);

/* ============================================================
 * GET /api/admin/classrooms/:id
 * ==========================================================*/
router.get(
  "/:id",
  verifyToken,
  verifyRole(["admin", "school_manager", "teacher"]),
  async (req, res) => {
    try {
      const { id } = req.params;
      if (!mongoose.Types.ObjectId.isValid(id)) {
        return res.status(400).json({ message: "Id lớp không hợp lệ" });
      }

      const role = req.user.role;

      const classroom = await Classroom.findById(id)
        .populate("school", "name code")
        .populate("homeroomTeacher", "name email role")
        .populate("students", "name email")
        .populate("schoolYear", "name")
        .lean();

      if (!classroom) {
        return res.status(404).json({ message: "Không tìm thấy lớp học" });
      }

      if (role !== "admin") {
        if (!req.user.school) {
          return res
            .status(403)
            .json({ message: "Tài khoản chưa được gắn với trường nào" });
        }

        const classroomSchoolId =
          classroom.school?._id?.toString() ||
          (typeof classroom.school === "string"
            ? classroom.school
            : classroom.school?.toString());

        if (
          !classroomSchoolId ||
          classroomSchoolId !== String(req.user.school)
        ) {
          return res.status(403).json({
            message: "Bạn không có quyền xem lớp thuộc trường khác",
          });
        }
      }

      res.json({ classroom });
    } catch (err) {
      console.error("Lỗi khi lấy chi tiết lớp:", err);
      res.status(500).json({ message: "Server error" });
    }
  }
);

/* ============================================================
 * POST /api/admin/classrooms
 * body: { name, grade, schoolId, homeroomTeacherId, schoolYearId }
 * ==========================================================*/
router.post(
  "/",
  verifyToken,
  verifyRole(["admin", "school_manager"]),
  async (req, res) => {
    try {
      const { name, grade, schoolId, homeroomTeacherId, schoolYearId } =
        req.body;
      const role = req.user.role;

      let schoolIdToUse = schoolId;
      if (role === "school_manager") {
        if (!req.user.school) {
          return res.status(403).json({
            message: "Tài khoản quản lý trường chưa gắn với trường nào",
          });
        }
        schoolIdToUse = req.user.school;
      }

      if (!name || !schoolIdToUse || !schoolYearId) {
        return res.status(400).json({
          message: "Tên lớp, trường và năm học là bắt buộc",
        });
      }

      if (!mongoose.Types.ObjectId.isValid(schoolIdToUse)) {
        return res.status(400).json({ message: "schoolId không hợp lệ" });
      }
      if (!mongoose.Types.ObjectId.isValid(schoolYearId)) {
        return res.status(400).json({ message: "schoolYearId không hợp lệ" });
      }

      const school = await School.findById(schoolIdToUse);
      if (!school) {
        return res.status(400).json({ message: "Trường không tồn tại" });
      }

      const year = await SchoolYear.findById(schoolYearId);
      if (!year) {
        return res.status(400).json({ message: "Năm học không tồn tại" });
      }

      // xử lý giáo viên tiếng Anh
      let teacherIdToUse = undefined;
      if (homeroomTeacherId) {
        if (!mongoose.Types.ObjectId.isValid(homeroomTeacherId)) {
          return res
            .status(400)
            .json({ message: "homeroomTeacherId không hợp lệ" });
        }

        const teacher = await User.findById(homeroomTeacherId);
        if (!teacher) {
          return res
            .status(400)
            .json({ message: "Giáo viên tiếng Anh không tồn tại" });
        }
        if (teacher.role !== "teacher") {
          return res.status(400).json({
            message: "Giáo viên tiếng Anh phải có role = teacher",
          });
        }

        if (!teacher.school) {
          teacher.school = schoolIdToUse;
          await teacher.save();
        } else if (String(teacher.school) !== String(schoolIdToUse)) {
          return res.status(400).json({
            message: "Giáo viên thuộc trường khác, không thể gán cho lớp này",
          });
        }

        teacherIdToUse = homeroomTeacherId;
      }

      const classroom = await Classroom.create({
        name: name.trim(),
        grade: grade || undefined,
        school: schoolIdToUse,
        schoolYear: schoolYearId,
        homeroomTeacher: teacherIdToUse,
      });

      const populated = await Classroom.findById(classroom._id)
        .populate("school", "name code")
        .populate("homeroomTeacher", "name email role")
        .populate("schoolYear", "name")
        .lean();

      res.status(201).json({ classroom: populated });
    } catch (err) {
      console.error("Lỗi khi tạo lớp:", err);
      res.status(500).json({ message: "Server error" });
    }
  }
);

/* ============================================================
 * PUT /api/admin/classrooms/:id
 * body: { name?, grade?, schoolId?, homeroomTeacherId?, schoolYearId? }
 * ==========================================================*/
router.put(
  "/:id",
  verifyToken,
  verifyRole(["admin", "school_manager"]),
  async (req, res) => {
    try {
      const { id } = req.params;
      if (!mongoose.Types.ObjectId.isValid(id)) {
        return res.status(400).json({ message: "Id lớp không hợp lệ" });
      }

      const { name, grade, schoolId, homeroomTeacherId, schoolYearId } =
        req.body;
      const role = req.user.role;

      const classroom = await Classroom.findById(id);
      if (!classroom) {
        return res.status(404).json({ message: "Không tìm thấy lớp học" });
      }

      // school_manager: chỉ được sửa lớp trong trường của mình
      if (role === "school_manager") {
        if (!req.user.school) {
          return res.status(403).json({
            message: "Tài khoản quản lý trường chưa gắn với trường nào",
          });
        }
        if (String(classroom.school) !== String(req.user.school)) {
          return res.status(403).json({
            message: "Bạn không có quyền sửa lớp thuộc trường khác",
          });
        }
      }

      // cập nhật name / grade nếu gửi
      if (typeof name !== "undefined") classroom.name = name;
      if (typeof grade !== "undefined") classroom.grade = grade;

      // cập nhật năm học (chỉ cho admin)
      if (typeof schoolYearId !== "undefined" && role === "admin") {
        if (!schoolYearId) {
          return res
            .status(400)
            .json({ message: "Năm học không được để trống" });
        }
        if (!mongoose.Types.ObjectId.isValid(schoolYearId)) {
          return res
            .status(400)
            .json({ message: "schoolYearId không hợp lệ" });
        }
        const year = await SchoolYear.findById(schoolYearId);
        if (!year) {
          return res.status(400).json({ message: "Năm học không tồn tại" });
        }
        classroom.schoolYear = schoolYearId;
      }

      // cập nhật trường nếu gửi
      if (typeof schoolId !== "undefined") {
        if (role === "admin") {
          if (schoolId) {
            if (!mongoose.Types.ObjectId.isValid(schoolId)) {
              return res
                .status(400)
                .json({ message: "schoolId không hợp lệ" });
            }
            const school = await School.findById(schoolId);
            if (!school) {
              return res.status(400).json({ message: "Trường không tồn tại" });
            }
            classroom.school = schoolId;
          } else {
            classroom.school = null;
          }
        } else {
          classroom.school = req.user.school || classroom.school;
        }
      }

      // xử lý giáo viên tiếng Anh
      if (typeof homeroomTeacherId !== "undefined") {
        if (homeroomTeacherId) {
          if (!mongoose.Types.ObjectId.isValid(homeroomTeacherId)) {
            return res
              .status(400)
              .json({ message: "homeroomTeacherId không hợp lệ" });
          }

          const teacher = await User.findById(homeroomTeacherId);
          if (!teacher) {
            return res
              .status(400)
              .json({ message: "Giáo viên tiếng Anh không tồn tại" });
          }
          if (teacher.role !== "teacher") {
            return res.status(400).json({
              message: "Giáo viên tiếng Anh phải có role = teacher",
            });
          }

          if (!teacher.school) {
            teacher.school = classroom.school;
            await teacher.save();
          } else if (String(teacher.school) !== String(classroom.school)) {
            return res.status(400).json({
              message: "Giáo viên thuộc trường khác, không thể gán cho lớp này",
            });
          }

          classroom.homeroomTeacher = homeroomTeacherId;
        } else {
          classroom.homeroomTeacher = null;
        }
      }

      await classroom.save();

      const populated = await Classroom.findById(classroom._id)
        .populate("school", "name code")
        .populate("homeroomTeacher", "name email role")
        .populate("schoolYear", "name")
        .lean();

      res.json({ classroom: populated });
    } catch (err) {
      console.error("Lỗi khi cập nhật lớp:", err);
      res.status(500).json({ message: "Server error" });
    }
  }
);

/* ============================================================
 * DELETE /api/admin/classrooms/:id
 * ==========================================================*/
router.delete(
  "/:id",
  verifyToken,
  verifyRole(["admin", "school_manager"]),
  async (req, res) => {
    try {
      const { id } = req.params;
      if (!mongoose.Types.ObjectId.isValid(id)) {
        return res.status(400).json({ message: "Id lớp không hợp lệ" });
      }

      const role = req.user.role;

      const classroom = await Classroom.findById(id);
      if (!classroom) {
        return res.status(404).json({ message: "Không tìm thấy lớp học" });
      }

      // school_manager chỉ xoá lớp trong trường của mình
      if (role === "school_manager") {
        if (!req.user.school) {
          return res.status(403).json({
            message: "Tài khoản quản lý trường chưa gắn với trường nào",
          });
        }
        if (String(classroom.school) !== String(req.user.school)) {
          return res.status(403).json({
            message: "Bạn không có quyền xoá lớp thuộc trường khác",
          });
        }
      }

      // ⛔ CHẶN XOÁ NẾU LỚP CÒN HỌC SINH
      if (Array.isArray(classroom.students) && classroom.students.length > 0) {
        return res.status(400).json({
          message:
            "Không thể xoá lớp vì vẫn còn học sinh trong lớp. " +
            "Vui lòng chuyển hoặc xoá học sinh trước.",
        });
      }

      await classroom.deleteOne();

      res.json({ message: "Đã xoá lớp học", classroom });
    } catch (err) {
      console.error("Lỗi khi xoá lớp:", err);
      res.status(500).json({ message: "Server error" });
    }
  }
);


export default router;
