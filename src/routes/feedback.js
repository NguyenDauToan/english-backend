// ./routes/feedback.js
import express from "express";
import Feedback from "../models/feedback.js";
import { verifyToken, verifyRole } from "../middleware/auth.js";
import Classroom from "../models/classroom.js";
import School from "../models/school.js";
import User from "../models/user.js";

const router = express.Router();

/* =========================================================
 * 🟢 Student gửi feedback (gắn theo lớp + GVCN)
 *  - Chỉ học sinh được gửi
 *  - Tự động gắn school, classroom, toTeacher (GVCN)
 * ======================================================= */
router.post("/", verifyToken, verifyRole(["student"]), async (req, res) => {
  try {
    const { message } = req.body;
    if (!message || message.trim() === "") {
      return res
        .status(400)
        .json({ message: "Nội dung phản hồi không được để trống" });
    }

    // 1) Lấy thông tin học sinh
    const student = await User.findById(req.user.id)
      .populate("school", "_id name code")
      .populate({
        path: "classroom",
        select: "_id name grade school homeroomTeacher",
        populate: [
          { path: "school", select: "_id name code" },
          { path: "homeroomTeacher", select: "_id name email role" },
        ],
      });

    let schoolId = null;
    let classroomId = null;
    let toTeacherId = null;

    if (student?.classroom) {
      const cls = student.classroom;
      classroomId = cls._id;
      if (cls.school) {
        schoolId = cls.school._id || cls.school;
      } else if (student.school) {
        schoolId = student.school._id || student.school;
      }
      if (cls.homeroomTeacher) {
        toTeacherId = cls.homeroomTeacher._id || cls.homeroomTeacher;
      }
    } else if (student?.school) {
      schoolId = student.school._id || student.school;
    }

    // 2) Tạo feedback
    const created = await Feedback.create({
      user: req.user.id,
      message,
      school: schoolId || undefined,
      classroom: classroomId || undefined,
      toTeacher: toTeacherId || undefined,
      status: "pending",
    });

    // 3) Populate để trả về đầy đủ
    const feedback = await Feedback.findById(created._id)
      .populate("user", "name email")
      .populate("toTeacher", "name email")
      .populate("school", "name code")
      .populate("classroom", "name grade");

    // 4) Bắn socket
    const io = req.app.get("io");
    if (io) {
      const studentId = feedback.user?._id
        ? String(feedback.user._id)
        : String(feedback.user);
      const teacherId = feedback.toTeacher?._id
        ? String(feedback.toTeacher._id)
        : feedback.toTeacher
        ? String(feedback.toTeacher)
        : null;

      // tới chính học sinh (phòng theo userId)
      if (studentId) {
        io.to(studentId).emit("receive_message", feedback);
      }

      // tới giáo viên chủ nhiệm (phòng theo userId của GV)
      if (teacherId) {
        io.to(teacherId).emit("receive_message", feedback);
      }

      // thông báo cho màn giám sát (admin / school_manager)
      io.emit("admin_new_message", feedback);
    }

    res.status(201).json({ message: "Gửi phản hồi thành công", feedback });
  } catch (err) {
    console.error("Lỗi tạo feedback:", err);
    res.status(500).json({ message: err.message });
  }
});

/* =========================================================
 * 🔵 Xem danh sách feedback
 *  - teacher: chỉ xem feedback gửi cho mình
 *  - admin: xem tất cả
 *  - school_manager: xem trong trường mình (giả sử req.user.school)
 *  - có hỗ trợ filter qua query:
 *      ?schoolId=&classroomId=&status=&teacherId=&studentId=
 * ======================================================= */
router.get(
  "/",
  verifyToken,
  verifyRole(["teacher", "admin", "school_manager"]),
  async (req, res) => {
    try {
      const {
        schoolId,
        classroomId,
        status,
        teacherId,
        studentId,
      } = req.query;

      const filter = {};

      // filter mặc định theo role
      if (req.user.role === "teacher") {
        filter.toTeacher = req.user.id;
      }

      if (req.user.role === "school_manager") {
        // tuỳ cách bạn lưu field trường cho school_manager
        // ở đây giả sử user có field "school"
        if (req.user.school) {
          filter.school = req.user.school;
        }
      }

      // filter thêm từ query
      if (schoolId) filter.school = schoolId;
      if (classroomId) filter.classroom = classroomId;
      if (status) filter.status = status;
      if (teacherId) filter.toTeacher = teacherId;
      if (studentId) filter.user = studentId;

      const feedbacks = await Feedback.find(filter)
        .populate("user", "name email")
        .populate("repliedBy", "name email")
        .populate("school", "name code")
        .populate("classroom", "name grade")
        .populate("toTeacher", "name email")
        .sort({ createdAt: -1 });

      return res.json(feedbacks);
    } catch (err) {
      console.error("Lỗi lấy feedback:", err);
      return res.status(500).json({ message: err.message });
    }
  }
);

/* =========================================================
 * 🟣 Teacher trả lời feedback
 *  - Chỉ teacher được trả lời
 *  - Teacher chỉ trả lời feedback gửi cho mình
 *  - Trả lời xong tự chuyển status = "resolved"
 * ======================================================= */
router.post(
  "/:id/reply",
  verifyToken,
  verifyRole(["teacher"]),
  async (req, res) => {
    try {
      const { reply } = req.body;
      if (!reply || reply.trim() === "") {
        return res
          .status(400)
          .json({ message: "Nội dung trả lời không được để trống" });
      }

      let feedback = await Feedback.findById(req.params.id);
      if (!feedback)
        return res.status(404).json({ message: "Không tìm thấy phản hồi" });

      // Teacher chỉ được trả lời feedback gửi cho mình
      if (String(feedback.toTeacher) !== String(req.user.id)) {
        return res
          .status(403)
          .json({ message: "Bạn không có quyền trả lời phản hồi này" });
      }

      feedback.reply = reply;
      feedback.repliedBy = req.user.id;
      feedback.status = "resolved";
      await feedback.save();

      await feedback.populate([
        { path: "user", select: "name email" },
        { path: "repliedBy", select: "name email" },
        { path: "school", select: "name code" },
        { path: "classroom", select: "name grade" },
        { path: "toTeacher", select: "name email" },
      ]);

      const io = req.app.get("io");
      if (io && feedback.user) {
        const studentId =
          typeof feedback.user === "object"
            ? String(feedback.user._id)
            : String(feedback.user);
        const teacherId = feedback.toTeacher?._id
          ? String(feedback.toTeacher._id)
          : feedback.toTeacher
          ? String(feedback.toTeacher)
          : null;

        // gửi cho học sinh
        if (studentId) {
          io.to(studentId).emit("receive_message", feedback);
        }

        // đồng bộ cho giáo viên (nếu đang mở UI ở tab khác)
        if (teacherId) {
          io.to(teacherId).emit("receive_message", feedback);
        }

        // thông báo cho admin / school_manager
        io.emit("admin_new_message", feedback);
      }

      return res.json({
        message: "Trả lời phản hồi thành công",
        feedback,
      });
    } catch (err) {
      console.error("Lỗi trả lời phản hồi:", err);
      return res.status(500).json({ message: err.message });
    }
  }
);

/* =========================================================
 * 🟢 Student xem feedback của chính mình
 * ======================================================= */
router.get("/mine", verifyToken, verifyRole(["student"]), async (req, res) => {
  try {
    const feedbacks = await Feedback.find({ user: req.user.id })
      .populate("repliedBy", "name email")
      .populate("school", "name code")
      .populate("classroom", "name grade")
      .populate("toTeacher", "name email")
      .sort({ createdAt: -1 });

    return res.json(feedbacks);
  } catch (err) {
    console.error("Lỗi lấy feedback của học sinh:", err);
    return res.status(500).json({ message: err.message });
  }
});
// 🔢 Đếm số feedback đang chờ xử lý (pending)
router.get(
  "/pending-count",
  verifyToken,
  verifyRole(["teacher", "admin", "school_manager"]),
  async (req, res) => {
    try {
      const filter = { status: "pending" };

      if (req.user.role === "teacher") {
        // giáo viên: chỉ feedback gửi cho mình
        filter.toTeacher = req.user.id;
      }

      if (req.user.role === "school_manager") {
        // school_manager: feedback trong trường mình
        if (!req.user.school) {
          return res
            .status(400)
            .json({ message: "Tài khoản chưa gắn với trường nào" });
        }
        filter.school = req.user.school;
      }

      const count = await Feedback.countDocuments(filter);
      return res.json({ count });
    } catch (err) {
      console.error("Lỗi đếm feedback pending:", err);
      return res.status(500).json({ message: err.message });
    }
  }
);

export default router;
