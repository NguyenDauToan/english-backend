// src/routes/admin.js
import express from "express";
import Test from "../models/test.js";
import User from "../models/user.js";
import Result from "../models/result.js";
import Question from "../models/question.js";
import Feedback from "../models/feedback.js";
import School from "../models/school.js";
import Classroom from "../models/classroom.js";
import { verifyToken, verifyRole } from "../middleware/auth.js";

const router = express.Router();

/* ============================================
 *  1. DASHBOARD ADMIN
 *  GET /api/admin/dashboard
 * ========================================== */
router.get(
  "/dashboard",
  verifyToken,
  verifyRole(["admin", "school_manager", "teacher"]),
  async (req, res) => {
    try {
      const role = req.user.role;
      const currentUserId = req.user._id || req.user.id;

      /* -----------------------------------------
       * 1. Xây studentFilter theo role
       * --------------------------------------- */
      let studentFilter = { role: "student" };

      if (role === "school_manager") {
        if (!req.user.school) {
          return res
            .status(403)
            .json({ message: "Tài khoản quản lý trường chưa gắn với trường nào" });
        }
        studentFilter.school = req.user.school;
      }

      let classIds = [];
      if (role === "teacher") {
        if (!req.user.school) {
          return res
            .status(403)
            .json({ message: "Giáo viên chưa được gắn trường" });
        }

        const homeroomClasses = await Classroom.find({
          homeroomTeacher: currentUserId,
        }).select("_id");

        classIds = homeroomClasses.map((c) => c._id);

        if (!classIds.length) {
          // Không chủ nhiệm lớp nào -> trả về thống kê rỗng
          return res.json({
            stats: [
              {
                title: "Tổng số học sinh",
                value: 0,
                description: "Bạn chưa chủ nhiệm lớp nào",
                icon: "Users",
                color: "text-blue-600",
              },
            ],
            activities: [],
            quickStats: {
              examsToday: 0,
              onlineUsers: 0,
              onlineUserList: [],
              newUsersThisWeek: 0,
              newTestsThisWeek: 0,
              pendingFeedbacks: 0,
              totalUsers: 0,
              totalStudents: 0,
              totalTeachers: 0,
              totalTests: 0,
              totalResults: 0,
              totalQuestions: 0,
              totalSchools: 0,
              totalClasses: 0,
              totalSchoolManagers: 0,
            },
          });
        }

        studentFilter.school = req.user.school;
        studentFilter.$or = [
          { classroom: { $in: classIds } },
          { classes: { $in: classIds } },
        ];
      }

      // Lấy danh sách ID học sinh theo filter trên
      const studentIds = await User.find(studentFilter).distinct("_id");

      /* -----------------------------------------
       * 2. Thống kê người dùng theo role
       *    (KHÔNG tính tài khoản admin)
       * --------------------------------------- */
      let totalUsers = 0;
      let totalStudents = 0;
      let totalTeachers = 0;
      let totalSchoolManagers = 0;

      if (role === "admin") {
        // Admin: thống kê toàn hệ thống nhưng không tính admin
        totalUsers = await User.countDocuments({
          role: { $ne: "admin" },
        });
        totalStudents = await User.countDocuments({ role: "student" });
        totalTeachers = await User.countDocuments({ role: "teacher" });
        totalSchoolManagers = await User.countDocuments({
          role: "school_manager",
        });
      } else if (role === "school_manager") {
        if (!req.user.school) {
          return res
            .status(403)
            .json({ message: "Tài khoản quản lý trường chưa gắn với trường nào" });
        }

        const schoolFilter = { school: req.user.school };


        totalStudents = await User.countDocuments({
          ...schoolFilter,
          role: "student",
        });
      
        totalTeachers = await User.countDocuments({
          ...schoolFilter,
          role: "teacher",
        });
        totalSchoolManagers = await User.countDocuments({
          ...schoolFilter,
          role: "school_manager",
        });
        totalUsers = totalStudents + totalTeachers;

      } else if (role === "teacher") {

        // Giáo viên: chỉ thống kê học sinh thuộc các lớp mình chủ nhiệm
        totalStudents = studentIds.length;
        totalUsers = totalStudents;
        totalTeachers = 0;
        totalSchoolManagers = 0;
      }

      /* -----------------------------------------
       * 3. Thống kê kết quả thi
       * --------------------------------------- */
      let resultMatch = {};
      if (role === "admin") {
        resultMatch = {};
      } else {
        resultMatch = studentIds.length
          ? { user: { $in: studentIds } }
          : { user: null }; // để count = 0
      }

      // LỌC ĐỀ THEO TRƯỜNG / PHẠM VI ROLE
      let testFilter = {};
      if (role === "admin") {
        testFilter = {};
      } else if (role === "school_manager") {
        // chỉ đề của trường mình
        testFilter = { school: req.user.school };
      } else if (role === "teacher") {
        // giáo viên: đề thuộc trường mình
        testFilter = { school: req.user.school };
      }

      const totalTests = await Test.countDocuments(testFilter);
      const totalQuestions = await Question.countDocuments(); // nếu muốn chia theo trường thì cần thêm field school cho Question

      const totalResults = await Result.countDocuments(resultMatch);

      const avgScoreAgg = await Result.aggregate([
        {
          $match: {
            ...resultMatch,
            score: { $ne: null },
          },
        },
        { $group: { _id: null, avgScore: { $avg: "$score" } } },
      ]);
            // ===== THỐNG KÊ THAM GIA / ĐẠT / RỚT =====
      // Giả sử điểm tối đa là 10, đậu khi >= 5
      const PASS_THRESHOLD = 5;

      // Số HỌC SINH khác nhau có ít nhất 1 kết quả
      const participatedStudentIds = await Result.distinct("user", {
        ...resultMatch,
        score: { $ne: null }
      });
      const participatedStudents = participatedStudentIds.length;

      // Số lượt thi ĐẠT
      const passedAttempts = await Result.countDocuments({
        ...resultMatch,
        score: { $ne: null, $gte: PASS_THRESHOLD },
      });

      // Số lượt thi RỚT
      const failedAttempts = await Result.countDocuments({
        ...resultMatch,
        score: { $ne: null, $lt: PASS_THRESHOLD },
      });

      const avgScore =
        avgScoreAgg.length > 0 ? avgScoreAgg[0].avgScore.toFixed(1) : 0;

      const completedExams = await Result.countDocuments({
        ...resultMatch,
        "answers.0": { $exists: true },
      });

      const completionRate =
        totalResults > 0
          ? ((completedExams / totalResults) * 100).toFixed(1) + "%"
          : "0%";

      const activitiesRaw = await Result.find(resultMatch)
        .sort({ createdAt: -1 })
        .limit(5)
        .populate("user", "name")
        .populate("test", "title")
        .lean();

      const recentActivities = activitiesRaw.map((r) => ({
        action: `Hoàn thành bài thi ${r.test?.title || "N/A"}`,
        user: r.user?.name || "Unknown",
        time: r.createdAt,
      }));

      /* -----------------------------------------
       * 4. Thống kê theo thời gian
       * --------------------------------------- */
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);

      const examsToday = await Result.countDocuments({
        ...resultMatch,
        createdAt: { $gte: todayStart },
      });

      const last7Days = new Date();
      last7Days.setDate(last7Days.getDate() - 7);

      const newUsersThisWeek = await User.countDocuments({
        ...studentFilter,
        createdAt: { $gte: last7Days },
      });

      const newTestsThisWeek = await Test.countDocuments({
        ...testFilter,
        createdAt: { $gte: last7Days },
      });

      // Lọc feedback theo học sinh/ trường (nếu Feedback có field user)
      let feedbackMatch = { status: "pending" };
      if (role !== "admin") {
        // chỉ feedback của học sinh thuộc phạm vi mình quản lý
        feedbackMatch.user = { $in: studentIds };
      }
      const pendingFeedbacks = await Feedback.countDocuments(feedbackMatch);

      /* -----------------------------------------
       * 5. Thống kê trường / lớp theo role
       * --------------------------------------- */
      let totalSchools = 0;
      let totalClasses = 0;

      if (role === "admin") {
        totalSchools = await School.countDocuments();
        totalClasses = await Classroom.countDocuments();
      } else {
        // school_manager / teacher -> chỉ trong trường của mình
        totalSchools = req.user.school ? 1 : 0;
        if (req.user.school) {
          totalClasses = await Classroom.countDocuments({
            school: req.user.school,
          });
        }
      }

      /* -----------------------------------------
       * 6. Online users (chỉ student theo studentFilter)
       * --------------------------------------- */
      let onlineUserList = [];
      let onlineUsers = 0;
      if (User.schema.paths.lastActive) {
        const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);

        const onlineStudents = await User.find({
          ...studentFilter,
          lastActive: { $gte: fiveMinutesAgo },
        })
          .select("_id name email role lastActive")
          .lean();

        onlineUserList = Array.from(
          new Map(onlineStudents.map((u) => [u._id.toString(), u])).values()
        );
        onlineUsers = onlineUserList.length;
      }

      /* -----------------------------------------
       * 7. quickStats trả về FE
       * --------------------------------------- */
      const quickStats = {
        examsToday,
        onlineUsers,
        onlineUserList,
        newUsersThisWeek,
        newTestsThisWeek,
        pendingFeedbacks,
        totalUsers,
        totalStudents,
        totalTeachers,
        totalTests,
        totalResults,
        totalQuestions,
        totalSchools,
        totalClasses,
        totalSchoolManagers,

        // 🔽 mới thêm
        participatedStudents, // số học sinh đã từng làm ít nhất 1 đề
        passedAttempts,       // số lượt thi đạt
        failedAttempts,       // số lượt thi rớt
      };


      /* -----------------------------------------
       * 8. Các card chính trả về FE
       * --------------------------------------- */
      const baseStats = [
        {
          title: "Tổng số người dùng",
          value: totalUsers,
          description:
            role === "admin"
              ? "Tài khoản học sinh, giáo viên, quản lý (không gồm admin)"
              : role === "school_manager"
              ? "Tài khoản học sinh, giáo viên, quản lý trong trường bạn"
              : "Tổng số học sinh trong các lớp bạn chủ nhiệm",
          icon: "Users",
          color: "text-blue-600",
        },
        {
          title: "Tổng số học sinh",
          value: totalStudents,
          description:
            role === "admin"
              ? "Tổng số học sinh trong hệ thống"
              : role === "school_manager"
              ? "Học sinh thuộc trường bạn"
              : "Học sinh trong các lớp bạn chủ nhiệm",
          icon: "UserRound",
          color: "text-emerald-600",
        },
      ];

      if (role === "admin" || role === "school_manager") {
        baseStats.push({
          title: "Tổng số giáo viên",
          value: totalTeachers,
          description:
            role === "admin"
              ? "Giáo viên trong toàn hệ thống"
              : "Giáo viên trong trường bạn",
          icon: "GraduationCap",
          color: "text-indigo-600",
        });
      }

      baseStats.push(
        {
          title: "Tổng số đề thi",
          value: totalTests,
          description:
            role === "admin"
              ? "Tổng số đề thi hiện có"
              : "Đề thi thuộc trường bạn",
          icon: "FileText",
          color: "text-green-600",
        },
        {
          title: "Tổng số câu hỏi",
          value: totalQuestions,
          description: "Số câu hỏi trong ngân hàng",
          icon: "HelpCircle",
          color: "text-pink-600",
        },
        {
          title: "Điểm trung bình",
          value: avgScore,
          description: "Điểm trung bình của các bài thi",
          icon: "TrendingUp",
          color: "text-purple-600",
        },
        {
          title: "Tỉ lệ hoàn thành",
          value: completionRate,
          description: "Tỉ lệ bài thi có nộp kết quả",
          icon: "CheckCircle",
          color: "text-orange-600",
        },
        {
          title: "Tổng số trường học",
          value: totalSchools,
          description:
            role === "admin"
              ? "Số trường đã cấu hình trong hệ thống"
              : "Trường bạn đang phụ trách",
          icon: "School",
          color: "text-indigo-600",
        },
        {
          title: "Tổng số lớp học",
          value: totalClasses,
          description:
            role === "admin"
              ? "Số lớp thuộc tất cả các trường"
              : "Số lớp thuộc trường bạn",
          icon: "Layers",
          color: "text-teal-600",
        },
        {
          title: "Quản lý trường",
          value: totalSchoolManagers,
          description:
            role === "admin"
              ? "Số tài khoản quản lý trường học"
              : "Số quản lý trong trường bạn",
          icon: "UserCog",
          color: "text-amber-600",
        }
      );

      return res.json({
        stats: baseStats,
        activities: recentActivities,
        quickStats,
      });
    } catch (err) {
      console.error("Lỗi khi lấy dữ liệu admin dashboard:", err);
      return res.status(500).json({ message: "Server error" });
    }
  }
);


/* ============================================
 *  2. QUẢN LÝ TRƯỜNG HỌC
 * ========================================== */

// GET /api/admin/schools (PUBLIC cho đăng ký)
router.get("/schools", async (req, res) => {
  try {
    const schools = await School.find()
      .populate("manager", "name email role")
      .lean();

    res.json({ schools });
  } catch (err) {
    console.error("Lỗi khi lấy danh sách trường:", err);
    res.status(500).json({ message: "Server error" });
  }
});

// POST /api/admin/schools
router.post(
  "/schools",
  verifyToken,
  verifyRole(["admin"]),
  async (req, res) => {
    try {
      const { name, code, address, managerId } = req.body;

      if (!name || !name.trim()) {
        return res
          .status(400)
          .json({ message: "Tên trường không được để trống" });
      }

      let manager = null;

      if (managerId) {
        manager = await User.findOne({
          _id: managerId,
          role: "school_manager",
        });

        if (!manager) {
          return res.status(400).json({
            message:
              "Không tìm thấy user quản lý trường với ID này hoặc role không phải school_manager",
          });
        }
      }

      const school = await School.create({
        name: name.trim(),
        code: code?.trim() || undefined,
        address: address?.trim() || undefined,
        manager: manager ? manager._id : undefined,
      });

      if (manager) {
        await User.findByIdAndUpdate(manager._id, { school: school._id });
      }

      const populatedSchool = await School.findById(school._id)
        .populate("manager", "name email role")
        .lean();

      return res.status(201).json({ school: populatedSchool });
    } catch (err) {
      console.error("Lỗi khi tạo trường:", err);
      res.status(500).json({ message: "Server error" });
    }
  }
);

// PUT /api/admin/schools/:id
router.put(
  "/schools/:id",
  verifyToken,
  verifyRole(["admin"]),
  async (req, res) => {
    try {
      const { id } = req.params;
      const { name, code, address, managerId } = req.body;

      const update = { name, code, address };
      if (typeof managerId !== "undefined") {
        update.manager = managerId || null;
      }

      const school = await School.findByIdAndUpdate(id, update, {
        new: true,
      })
        .populate("manager", "name email role")
        .lean();

      if (!school) {
        return res.status(404).json({ message: "Không tìm thấy trường học" });
      }

      res.json({ school });
    } catch (err) {
      console.error("Lỗi khi cập nhật trường:", err);
      res.status(500).json({ message: "Server error" });
    }
  }
);
// DELETE /api/admin/schools/:id?force=true
router.delete(
  "/schools/:id",
  verifyToken,
  verifyRole(["admin"]),
  async (req, res) => {
    try {
      const { id } = req.params;
      const force = req.query.force === "true"; // ?force=true => xoá cứng

      if (!id) {
        return res.status(400).json({ message: "Thiếu id trường" });
      }

      const school = await School.findById(id);
      if (!school) {
        return res.status(404).json({ message: "Không tìm thấy trường học" });
      }

      // ===== 1. Kiểm tra còn dữ liệu liên quan không =====
      const [hasClasses, hasStudents, hasTeachers, hasManagers, hasTests] =
        await Promise.all([
          Classroom.exists({ school: id }),
          User.exists({ school: id, role: "student" }),
          User.exists({ school: id, role: "teacher" }),
          User.exists({ school: id, role: "school_manager" }),
          Test.exists({ school: id }),
        ]);

      const hasData =
        hasClasses || hasStudents || hasTeachers || hasManagers || hasTests;

      // ===== 2. TRƯỜNG HỢP 2: CHẶN XOÁ NẾU CÒN DỮ LIỆU =====
      if (!force && hasData) {
        return res.status(400).json({
          message:
            "Không thể xoá trường vì vẫn còn lớp / học sinh / giáo viên / đề thi. " +
            "Vui lòng chuyển hoặc xoá dữ liệu liên quan trước.",
        });
      }

      // ===== 3. TRƯỜNG HỢP 1: XOÁ CỨNG + XOÁ HẾT DỮ LIỆU LIÊN QUAN =====
      if (force && hasData) {
        // Lấy danh sách id liên quan
        const [classDocs, studentIds, teacherIds, managerIds, testIds] =
          await Promise.all([
            Classroom.find({ school: id }).select("_id").lean(),
            User.find({ school: id, role: "student" }).distinct("_id"),
            User.find({ school: id, role: "teacher" }).distinct("_id"),
            User.find({ school: id, role: "school_manager" }).distinct("_id"),
            Test.find({ school: id }).distinct("_id"),
          ]);

        const classIds = classDocs.map((c) => c._id);
        const userIds = [...studentIds, ...teacherIds, ...managerIds];

        // Xoá kết quả, feedback gắn với user / test của trường
        await Promise.all([
          Result.deleteMany({
            $or: [
              { user: { $in: userIds } },
              { test: { $in: testIds } },
            ],
          }),
          Feedback.deleteMany({
            $or: [
              { user: { $in: userIds } },
              { test: { $in: testIds } },
            ],
          }),
        ]);

        // Xoá lớp, đề thi, (tuỳ chọn) user
        await Promise.all([
          Classroom.deleteMany({ _id: { $in: classIds } }),
          Test.deleteMany({ _id: { $in: testIds } }),
          // Nếu muốn KEEP tài khoản nhưng xoá school thì thay bằng updateMany
          User.deleteMany({ _id: { $in: userIds } }),
          // Ví dụ nếu chỉ muốn gỡ liên kết:
          // User.updateMany(
          //   { school: id },
          //   { $set: { school: null, classroom: null, classes: [] } }
          // ),
        ]);

        // Cuối cùng xoá trường
        await school.deleteOne();

        return res.json({
          message: "Đã xoá trường và toàn bộ dữ liệu liên quan",
          schoolId: id,
        });
      }

      // ===== 4. Trường không còn dữ liệu liên quan -> xoá bình thường =====
      await school.deleteOne();
      return res.json({ message: "Đã xoá trường học", school });
    } catch (err) {
      console.error("Lỗi khi xoá trường:", err);
      res.status(500).json({ message: "Server error" });
    }
  }
);

export default router;
