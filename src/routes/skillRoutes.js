// src/routes/skillRoutes.js
import express from "express";
import { verifyToken } from "../middleware/auth.js";
import Test from "../models/test.js";
import Skill from "../models/skillModel.js";

const router = express.Router();

/**
 * GET /api/skills
 *  - examCount: số đề có ÍT NHẤT 1 câu hỏi thuộc skill đó
 *  - questionCount: tổng số câu hỏi của skill đó trong tất cả đề
 */
router.get("/", verifyToken, async (req, res) => {
  try {
    // 1. Lấy danh sách skill đã seed
    const skillDocs = await Skill.find().lean();

    // 2. Thống kê từ Question.skill
    const agg = await Test.aggregate([
      {
        $lookup: {
          from: "questions",          // collection của model Question
          localField: "questions",    // mảng ObjectId trong Test
          foreignField: "_id",
          as: "questionDocs",
        },
      },
      { $unwind: "$questionDocs" },
      {
        $group: {
          _id: "$questionDocs.skill",   // skill của câu hỏi
          examIds: { $addToSet: "$_id" },
          totalQuestions: { $sum: 1 },
        },
      },
      {
        $project: {
          examCount: { $size: "$examIds" },
          totalQuestions: 1,
        },
      },
      { $match: { _id: { $ne: null } } },
    ]);

    const examCountMap = new Map(
      agg.map((d) => [d._id, d.examCount || 0])
    );
    const questionsMap = new Map(
      agg.map((d) => [d._id, d.totalQuestions || 0])
    );

    // 3. Hợp nhất skill từ bảng Skill + skill chỉ xuất hiện trong Test
    const skillsFromModel = skillDocs.map((s) => s.name);
    const skillsFromTests = agg.map((d) => d._id);
    const allSkillNames = Array.from(
      new Set([...skillsFromModel, ...skillsFromTests])
    );

    const data = allSkillNames.map((name) => {
      const doc = skillDocs.find((s) => s.name === name);

      return {
        name,
        displayName:
          doc?.displayName ||
          (name ? name.charAt(0).toUpperCase() + name.slice(1) : ""),
        description: doc?.description || "",
        examCount: examCountMap.get(name) || 0,
        questionCount: questionsMap.get(name) || 0,
      };
    });

    return res.json({ skills: data });
  } catch (err) {
    console.error("Lỗi /api/skills:", err);
    res.status(500).json({ message: "Không thể lấy danh sách kỹ năng" });
  }
});

export default router;
