// ./routes/feedback.js
import express from "express";
import Feedback from "../models/feedback.js";
import { verifyToken, verifyRole } from "../middleware/auth.js";

const router = express.Router();

// 🟢 Student gửi feedback
router.post("/", verifyToken, verifyRole(["student"]), async (req, res) => {
  try {
    const { message } = req.body;
    if (!message || message.trim() === "") {
      return res
        .status(400)
        .json({ message: "Nội dung phản hồi không được để trống" });
    }
    
    let feedback = await Feedback.create({
      user: req.user.id,
      message,
    });

    feedback = await feedback.populate("user", "name email");

    const io = req.app.get("io");
    if (io) {
      // ⬇⬇⬇ ĐỔI DÒNG NÀY
      // io.to("teachers").emit("admin_new_message", feedback);
      io.emit("admin_new_message", feedback); // bắn cho tất cả client
    }

    res.status(201).json({ message: "Gửi phản hồi thành công", feedback });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});


// 🔵 Teacher xem tất cả feedback
router.get("/", verifyToken, verifyRole(["teacher", "admin"]), async (req, res) => {
  try {
    const feedbacks = await Feedback.find()
      .populate("user", "name email")
      .populate("repliedBy", "name email")
      .sort({ createdAt: -1 });
    res.json(feedbacks);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// 🟡 Teacher cập nhật trạng thái feedback
router.put("/:id", verifyToken, verifyRole(["teacher", "admin"]), async (req, res) => {
  try {
    const { status } = req.body;
    if (!["pending", "resolved"].includes(status)) {
      return res.status(400).json({ message: "Trạng thái không hợp lệ" });
    }

    const feedback = await Feedback.findByIdAndUpdate(req.params.id, { status }, { new: true });
    if (!feedback) return res.status(404).json({ message: "Không tìm thấy phản hồi" });

    res.json({ message: "Cập nhật phản hồi thành công", feedback });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// 🟣 Teacher trả lời feedback
router.post("/:id/reply", verifyToken, verifyRole(["teacher", "admin"]), async (req, res) => {
  try {
    const { reply } = req.body;
    if (!reply || reply.trim() === "") {
      return res.status(400).json({ message: "Nội dung trả lời không được để trống" });
    }

    const feedback = await Feedback.findByIdAndUpdate(
      req.params.id,
      { reply, repliedBy: req.user.id, status: "resolved" },
      { new: true }
    )
      .populate("user", "name email")
      .populate("repliedBy", "name email");

    if (!feedback) return res.status(404).json({ message: "Không tìm thấy phản hồi" });

    // 🔔 BẮN SOCKET TỚI HỌC SINH
    const io = req.app.get("io");
    if (io && feedback.user) {
      const userId =
        typeof feedback.user === "object" ? feedback.user._id : feedback.user;
      io.to(String(userId)).emit("receive_message", feedback);
    }

    res.json({ message: "Trả lời phản hồi thành công", feedback });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});
// 🟢 Student xem feedback của chính mình
router.get("/mine", verifyToken, verifyRole(["student"]), async (req, res) => {
    try {
      const feedbacks = await Feedback.find({ user: req.user.id })
        .populate("repliedBy", "name email")
        .sort({ createdAt: -1 });
      res.json(feedbacks);
    } catch (err) {
      res.status(500).json({ message: err.message });
    }
  });
// 🔴 Teacher kết thúc toàn bộ cuộc hội thoại với 1 học sinh
router.post(
  "/:id/end-conversation",
  verifyToken,
  verifyRole(["teacher", "admin"]),
  async (req, res) => {
    try {
      const fb = await Feedback.findById(req.params.id);
      if (!fb) return res.status(404).json({ message: "Không tìm thấy phản hồi" });

      // set ended = true cho tất cả feedback của HS
      await Feedback.updateMany(
        { user: fb.user },
        { $set: { ended: true, status: "resolved" } }
      );

      const latest = await Feedback.find({ user: fb.user }).sort({ createdAt: 1 });

      // 👇 LẤY io TỪ server.js VÀ BẮN EVENT
      const io = req.app.get("io");
      if (io) {
        io.to(String(fb.user)).emit("conversation_ended", {
          userId: String(fb.user),
        });
      }

      res.json({
        message: "Đã kết thúc cuộc hội thoại với học sinh.",
        userId: fb.user,
        feedbacks: latest,
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: err.message });
    }
  }
);


export default router;
