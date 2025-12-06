// routes/teacherRequests.js
import express from "express";
import { verifyToken, verifyRole } from "../middleware/auth.js";
import TeacherRequest from "../models/teacherRequest.js";
import User from "../models/user.js";
import uploadTeacherRequest from "../middleware/uploadTeacherRequest.js";

const router = express.Router();

/* =========================================================
 * 1) Giáo viên gửi yêu cầu lên school_manager
 *  - Body: title, description, type, studentId, fromClassroomId, toClassroomId
 *  - File: field "files" (nhiều file Word/PDF)
 * ======================================================= */
router.post(
  "/",
  verifyToken,
  verifyRole(["teacher"]),
  uploadTeacherRequest.array("files", 5),
  async (req, res) => {
    try {
      const { title, description, type, studentId, fromClassroomId, toClassroomId } =
        req.body;

      if (!title || !title.trim()) {
        return res.status(400).json({ message: "Tiêu đề yêu cầu không được để trống" });
      }

      const teacher = await User.findById(req.user.id).populate("school", "_id name");
      if (!teacher) {
        return res.status(404).json({ message: "Không tìm thấy giáo viên" });
      }

      const attachments =
        (req.files || []).map((f) => ({
          fileName: f.originalname,
          url: `/uploads/teacher-requests/${f.filename}`, // hoặc full URL nếu bạn có static server
          mimeType: f.mimetype,
          size: f.size,
        })) || [];

      const created = await TeacherRequest.create({
        teacher: req.user.id,
        school: teacher.school?._id || teacher.school || undefined,
        type: type || "general",
        title: title.trim(),
        description: description?.trim() || "",
        student: studentId || undefined,
        fromClassroom: fromClassroomId || undefined,
        toClassroom: toClassroomId || undefined,
        attachments,
      });

      const populated = await TeacherRequest.findById(created._id)
        .populate("teacher", "name email")
        .populate("school", "name code")
        .populate("student", "name email")
        .populate("fromClassroom", "name grade")
        .populate("toClassroom", "name grade")
        .populate("handledBy", "name email");

      // nếu bạn có socket.io, có thể bắn cho school_manager trong trường
      const io = req.app.get("io");
      if (io && teacher.school) {
        // giả sử school_manager join vào room theo schoolId
        io.to(String(teacher.school._id || teacher.school)).emit(
          "teacher_request_new",
          populated
        );
      }

      return res.status(201).json({
        message: "Gửi yêu cầu thành công",
        request: populated,
      });
    } catch (err) {
      console.error("Lỗi gửi yêu cầu:", err);
      return res.status(500).json({ message: err.message });
    }
  }
);

/* =========================================================
 * 2) Danh sách yêu cầu
 *  - teacher: xem yêu cầu của chính mình
 *  - school_manager: xem yêu cầu trong trường mình
 *  - admin: xem tất cả
 *  Query: ?status=pending/approved/rejected
 * ======================================================= */
router.get(
  "/",
  verifyToken,
  verifyRole(["teacher", "school_manager", "admin"]),
  async (req, res) => {
    try {
      const { status } = req.query;
      const filter = {};

      if (status) filter.status = status;

      if (req.user.role === "teacher") {
        filter.teacher = req.user.id;
      }

      if (req.user.role === "school_manager") {
        // school_manager chỉ xem yêu cầu trong trường mình
        const manager = await User.findById(req.user.id);
        if (!manager?.school) {
          return res
            .status(400)
            .json({ message: "School_manager chưa được gán trường" });
        }
        filter.school = manager.school;
      }

      const list = await TeacherRequest.find(filter)
        .populate("teacher", "name email")
        .populate("school", "name code")
        .populate("student", "name email")
        .populate("fromClassroom", "name grade")
        .populate("toClassroom", "name grade")
        .populate("handledBy", "name email")
        .sort({ createdAt: -1 });

      return res.json(list);
    } catch (err) {
      console.error("Lỗi lấy danh sách yêu cầu:", err);
      return res.status(500).json({ message: err.message });
    }
  }
);

/* =========================================================
 * 3) School_manager / Admin duyệt yêu cầu
 *  - Body: { status: "approved" | "rejected", handledNote? }
 * ======================================================= */
router.patch(
  "/:id/status",
  verifyToken,
  verifyRole(["school_manager", "admin"]),
  async (req, res) => {
    try {
      const { status, handledNote } = req.body;
      if (!["approved", "rejected"].includes(status)) {
        return res.status(400).json({ message: "Trạng thái không hợp lệ" });
      }

      const request = await TeacherRequest.findById(req.params.id);
      if (!request) {
        return res.status(404).json({ message: "Không tìm thấy yêu cầu" });
      }

      // nếu là school_manager -> chỉ xử lý yêu cầu trong trường mình
      if (req.user.role === "school_manager") {
        const manager = await User.findById(req.user.id);
        if (
          !manager?.school ||
          String(manager.school) !== String(request.school)
        ) {
          return res
            .status(403)
            .json({ message: "Bạn không có quyền duyệt yêu cầu này" });
        }
      }

      request.status = status;
      request.handledBy = req.user.id;
      request.handledNote = handledNote || "";
      await request.save();

      const populated = await TeacherRequest.findById(request._id)
        .populate("teacher", "name email")
        .populate("school", "name code")
        .populate("student", "name email")
        .populate("fromClassroom", "name grade")
        .populate("toClassroom", "name grade")
        .populate("handledBy", "name email");

      const io = req.app.get("io");
      if (io) {
        // gửi thông báo cho giáo viên
        io.to(String(request.teacher)).emit("teacher_request_updated", populated);
      }

      return res.json({
        message: "Cập nhật trạng thái yêu cầu thành công",
        request: populated,
      });
    } catch (err) {
      console.error("Lỗi cập nhật trạng thái yêu cầu:", err);
      return res.status(500).json({ message: err.message });
    }
  }
);
// 4) Giáo viên thu hồi yêu cầu (xóa luôn)
router.patch(
    "/:id/cancel",
    verifyToken,
    verifyRole(["teacher"]),
    async (req, res) => {
      try {
        const { id } = req.params;
        const teacherId = req.user._id || req.user.id;
  
        const request = await TeacherRequest.findById(id);
        if (!request) {
          return res.status(404).json({ message: "Không tìm thấy yêu cầu" });
        }
  
        // chỉ được thu hồi yêu cầu của chính mình
        if (String(request.teacher) !== String(teacherId)) {
          return res
            .status(403)
            .json({ message: "Bạn không có quyền thu hồi yêu cầu này" });
        }
  
        // chỉ cho thu hồi khi đang chờ xử lý
        if (request.status !== "pending") {
          return res.status(400).json({
            message: "Chỉ thu hồi được yêu cầu đang ở trạng thái chờ xử lý",
          });
        }
  
        // XÓA LUÔN RECORD
        await request.deleteOne();
  
        // Nếu có socket.io thì có thể bắn event cho BGH (tùy bạn dùng hay không)
        const io = req.app.get("io");
        if (io) {
          io.to(String(request.school || "")).emit("teacher_request_deleted", {
            _id: id,
          });
        }
  
        return res.json({ message: "Đã thu hồi (xóa) yêu cầu thành công" });
      } catch (err) {
        console.error("Lỗi thu hồi yêu cầu:", err);
        return res.status(500).json({ message: "Lỗi server khi thu hồi yêu cầu" });
      }
    }
  );
  // 🔢 Đếm số yêu cầu giáo viên đang chờ xử lý
router.get(
  "/pending-count",
  verifyToken,
  verifyRole(["teacher", "school_manager", "admin"]),
  async (req, res) => {
    try {
      const filter = { status: "pending" };

      if (req.user.role === "teacher") {
        // giáo viên: chỉ yêu cầu của chính mình
        filter.teacher = req.user.id;
      }

      if (req.user.role === "school_manager") {
        // school_manager: yêu cầu trong trường mình
        const manager = await User.findById(req.user.id);
        if (!manager?.school) {
          return res
            .status(400)
            .json({ message: "School_manager chưa được gán trường" });
        }
        filter.school = manager.school;
      }

      const count = await TeacherRequest.countDocuments(filter);
      return res.json({ count }); 
    } catch (err) {
      console.error("Lỗi đếm yêu cầu giáo viên pending:", err);
      return res.status(500).json({ message: err.message });
    }
  }
);

export default router;
