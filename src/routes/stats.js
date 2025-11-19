// src/routes/stats.js
import express from "express";
import User from "../models/user.js";

const router = express.Router();

// API: lấy danh sách học viên online trong 1 phút gần nhất
router.get("/online-users", async (req, res) => {
  try {
    const oneMinuteAgo = new Date(Date.now() - 60 * 1000);

    const onlineUsers = await User.find(
      { 
        role: "student", // chỉ học viên
        lastActive: { $gte: oneMinuteAgo } 
      },
      "_id name email role"
    );

    // loại trùng user
    const uniqueUsers = Array.from(
      new Map(onlineUsers.map((u) => [u._id.toString(), u])).values()
    );

    res.json({
      count: uniqueUsers.length,
      users: uniqueUsers,
    });
  } catch (err) {
    console.error("❌ /online-users error:", err);
    res.status(500).json({ message: "Lỗi server" });
  }
});

export default router;
