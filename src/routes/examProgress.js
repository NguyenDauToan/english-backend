// src/routes/examProgress.js
import express from "express";
import mongoose from "mongoose";
import ExamProgress from "../models/examProgress.js";
import { verifyToken, verifyRole } from "../middleware/auth.js";

const router = express.Router();

// Lưu / cập nhật trạng thái bài thi (upsert)
router.post("/save", verifyToken, verifyRole(["student"]), async (req, res) => {
  try {
    const { testId, mockExamId, answers, currentIndex, timeUsed, timeLeft } =
      req.body;

    if (!testId && !mockExamId) {
      return res.status(400).json({ message: "Thiếu testId hoặc mockExamId" });
    }

    const query = {
      user: req.user._id,
      ...(testId ? { test: testId } : { mockExam: mockExamId }),
    };

    // gắn thêm thông tin lớp / trường hiện tại của user
    const update = {
      ...query,
      answers: answers || [],
      currentIndex: currentIndex ?? 0,
      timeUsed: timeUsed ?? 0,
      timeLeft: timeLeft ?? 0,
      school: req.user.school || undefined,
      classroom: req.user.classroom || undefined,
    };

    console.log("SAVE exam-progress", query, "with class", req.user.classroom);

    const progress = await ExamProgress.findOneAndUpdate(query, update, {
      new: true,
      upsert: true,
      setDefaultsOnInsert: true,
    });

    res.json(progress);
  } catch (err) {
    console.error("Lỗi lưu exam progress:", err);
    res.status(500).json({ message: "Lỗi server khi lưu trạng thái bài thi" });
  }
});

// Lấy progress của 1 bài theo testId / mockExamId
router.get(
  "/by-exam",
  verifyToken,
  verifyRole(["student"]),
  async (req, res) => {
    try {
      const { testId, mockExamId } = req.query;

      if (!testId && !mockExamId) {
        return res
          .status(400)
          .json({ message: "Thiếu testId hoặc mockExamId" });
      }

      const query = {
        user: req.user._id,
        ...(testId ? { test: testId } : { mockExam: mockExamId }),
      };

      console.log("LOAD exam-progress by-exam", query);

      const prog = await ExamProgress.findOne(query).lean();

      if (!prog) return res.json(null);

      res.json({
        answers: prog.answers || [],
        currentIndex: prog.currentIndex ?? 0,
        timeUsed: prog.timeUsed ?? 0,
        timeLeft: prog.timeLeft ?? 0,
      });
    } catch (err) {
      console.error("Lỗi lấy exam progress by-exam:", err);
      res
        .status(500)
        .json({ message: "Lỗi server khi lấy trạng thái bài thi" });
    }
  }
);

// Danh sách tất cả bài đang làm dở của user (lọc theo lớp hiện tại nếu có)
router.get("/me", verifyToken, verifyRole(["student"]), async (req, res) => {
  try {
    const rawUserId = String(req.user._id || req.user.id);
    const userId = new mongoose.Types.ObjectId(rawUserId);

    const query = { user: userId };

    // nếu user hiện tại đang thuộc lớp nào thì chỉ lấy progress của lớp đó
    if (req.user.classroom) {
      query.classroom = new mongoose.Types.ObjectId(
        String(req.user.classroom)
      );
    }

    console.log("LOAD exam-progress /me with filter:", query);

    const progresses = await ExamProgress.find(query)
      .populate("test", "title duration skill")
      .populate("mockExam", "name duration examType")
      .sort({ updatedAt: -1 });

    const data = progresses.map((p) => {
      const isMock = !!p.mockExam;
      const examTitle = p.test?.title || p.mockExam?.name || "Bài thi";

      return {
        _id: p._id,
        examId: p.test?._id || p.mockExam?._id,
        isMock,
        title: examTitle,
        duration: p.test?.duration || p.mockExam?.duration || undefined,
        timeLeft: p.timeLeft,
        skill: p.test?.skill || p.mockExam?.examType || undefined,
        updatedAt: p.updatedAt,
      };
    });

    res.json(data);
  } catch (err) {
    console.error("Lỗi lấy exam progress:", err);
    res
      .status(500)
      .json({ message: "Lỗi server khi lấy trạng thái bài thi" });
  }
});

// Xoá progress khi đã nộp bài
router.post(
  "/finish",
  verifyToken,
  verifyRole(["student"]),
  async (req, res) => {
    try {
      const { testId, mockExamId } = req.body;
      if (!testId && !mockExamId) {
        return res
          .status(400)
          .json({ message: "Thiếu testId hoặc mockExamId" });
      }

      const query = {
        user: req.user._id,
        ...(testId ? { test: testId } : { mockExam: mockExamId }),
      };

      console.log("FINISH exam-progress", query);

      await ExamProgress.deleteOne(query);
      res.json({ ok: true });
    } catch (err) {
      console.error("Lỗi xoá exam progress:", err);
      res
        .status(500)
        .json({ message: "Lỗi server khi xoá trạng thái bài thi" });
    }
  }
);

export default router;
