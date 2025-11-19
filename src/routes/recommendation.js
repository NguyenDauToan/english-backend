import express from "express";
import Question from "../models/question.js";
import Result from "../models/result.js";
import { verifyToken } from "../middleware/auth.js";

const router = express.Router();

/**
 * POST /api/recommendation
 * Gợi ý bài luyện tập dựa trên điểm yếu của học sinh
 */
router.post("/", verifyToken, async (req, res) => {
  try {
    const userId = req.user._id;

    // Lấy 10 kết quả gần nhất
    const results = await Result.find({ user: userId }).sort({ createdAt: -1 }).limit(10);

    if (!results.length) {
      return res.json({
        message: "Chưa có dữ liệu kết quả. Hãy làm bài luyện tập trước!",
        weakestSkill: null,
        stats: {},
        suggestedCourses: [],
      });
    }

    // Tính accuracy theo skill
    const skillStats = {}; // { skill: { correct: X, total: Y } }

    results.forEach(result => {
      result.answers.forEach(ans => {
        const skill = ans.skill || "unknown";
        if (!skillStats[skill]) skillStats[skill] = { correct: 0, total: 0 };
        skillStats[skill].total += 1;
        if (ans.isCorrect) skillStats[skill].correct += 1;
      });
    });

    // Tạo object chỉ chứa accuracy
    const skillAccuracy = {};
    Object.keys(skillStats).forEach(skill => {
      skillAccuracy[skill] = skillStats[skill].correct / skillStats[skill].total;
    });

    // Skill yếu nhất = accuracy thấp nhất
    const weakestSkill = Object.keys(skillAccuracy).sort(
      (a, b) => skillAccuracy[a] - skillAccuracy[b]
    )[0];

    // Gợi ý 5 câu hỏi theo skill yếu
    const suggestedCourses = await Question.find({
      skill: new RegExp(weakestSkill, "i")
    }).limit(5);

    res.json({
      message: `Bạn đang yếu ở phần "${weakestSkill}". Hãy luyện thêm nhé!`,
      weakestSkill,
      stats: skillAccuracy, // FE có thể nhân 100% để hiển thị
      suggestedCourses,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Lỗi khi gợi ý luyện tập thông minh." });
  }
});

export default router;
