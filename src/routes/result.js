// src/routes/results.js
import express from "express";
import Result from "../models/result.js";
import Question from "../models/question.js";
import SpeakingAttempt from "../models/speakingAttempt.js";
import Test from "../models/test.js";          // 👈 THÊM
import User from "../models/user.js";          // 👈 THÊM
import { verifyToken, verifyRole } from "../middleware/auth.js";
import Classroom from "../models/classroom.js";
import MockExam from "../models/mockExam.js";
const router = express.Router();
const normalize = (val) =>
  typeof val === "string" ? val.trim().toLowerCase() : "";

// chuẩn hóa câu cho writing: bỏ dấu câu, dư khoảng trắng
const normalizeSentence = (text = "") =>
  text
    .toString()
    .toLowerCase()
    .replace(/[.,!?;:'"-]/g, "") // bỏ dấu câu
    .replace(/\s+/g, " ")
    .trim();

// ============================
// POST /api/results/
// ============================

router.post("/", verifyToken, verifyRole(["student"]), async (req, res) => {
  try {
    const { testId, mockExamId, answers, timeSpent } = req.body;

    if (!testId && !mockExamId) {
      return res
        .status(400)
        .json({ message: "Thiếu testId hoặc mockExamId" });
    }

    if (!answers || !Array.isArray(answers)) {
      return res.status(400).json({ message: "Thiếu dữ liệu answers" });
    }

    if (answers.length === 0) {
      return res.status(400).json({ message: "Bài thi chưa có câu hỏi" });
    }

    let totalItems = 0;
    let totalCorrectItems = 0;

    const evaluatedAnswers = [];
    const skillStats = {};

    for (const ans of answers) {
      try {
        if (!ans?.questionId) continue;

        const question = await Question.findById(ans.questionId);
        if (!question) continue;

        const skillKey = question.skill || "unknown";
        const baseInfo = {
          question: question._id,
          skill: skillKey,
          grade: question.grade || "",
          type: question.type || "",
        };

        if (!skillStats[skillKey]) {
          skillStats[skillKey] = { total: 0, correct: 0 };
        }

        // CASE 1: reading_cloze nhiều subQuestions
        if (
          question.type === "reading_cloze" &&
          Array.isArray(question.subQuestions) &&
          question.subQuestions.length > 0
        ) {
          let userSubAnswers = [];
          try {
            if (typeof ans.answer === "string" && ans.answer.trim()) {
              userSubAnswers = JSON.parse(ans.answer);
            }
          } catch (e) {
            console.warn("Không parse được JSON answer cho reading_cloze:", e);
          }

          const subQs = question.subQuestions;
          const subCount = subQs.length;
          totalItems += subCount;

          subQs.forEach((subQ, subIdx) => {
            const opts = Array.isArray(subQ.options) ? subQ.options : [];
            const idxCorrect =
              typeof subQ.correctIndex === "number" ? subQ.correctIndex : 0;
            const correctText = opts[idxCorrect] ?? "";
            const correctNorm = normalize(correctText);

            const userAns = Array.isArray(userSubAnswers)
              ? userSubAnswers[subIdx] ?? ""
              : "";
            const userNorm = normalize(userAns);

            const isCorrect =
              correctNorm && userNorm && correctNorm === userNorm;

            if (isCorrect) {
              totalCorrectItems += 1;
              skillStats[skillKey].correct += 1;
            }
            skillStats[skillKey].total += 1;

            evaluatedAnswers.push({
              ...baseInfo,
              questionText:
                question.content +
                "\n(" +
                (subQ.label || `Question ${subIdx + 1}`) +
                ")",
              answer: userAns ?? "",
              correct: correctText,
              isCorrect,
              subIndex: subIdx,
            });
          });

          continue;
        }

        // CASE 2: writing_sentence_order – sắp xếp câu
        if (question.type === "writing_sentence_order") {
          totalItems += 1;

          let tokens = [];
          try {
            if (typeof ans.answer === "string" && ans.answer.trim()) {
              tokens = JSON.parse(ans.answer);
            } else if (Array.isArray(ans.answer)) {
              tokens = ans.answer;
            }
          } catch (e) {
            console.warn("Không parse được JSON answer cho writing:", e);
          }

          const userSentence = Array.isArray(tokens)
            ? tokens.join(" ")
            : (ans.answer || "").toString();

          const correctSentence = Array.isArray(question.answer)
            ? question.answer[0]
            : (question.answer || "");

          const userNorm = normalizeSentence(userSentence);
          const correctNorm = normalizeSentence(correctSentence);

          const isCorrect =
            !!userNorm && !!correctNorm && userNorm === correctNorm;

          if (isCorrect) {
            totalCorrectItems += 1;
            skillStats[skillKey].correct += 1;
          }
          skillStats[skillKey].total += 1;

          evaluatedAnswers.push({
            ...baseInfo,
            questionText: question.content,
            answer: userSentence,
            correct: correctSentence,
            isCorrect,
            subIndex: null,
          });

          continue;
        }

        // CASE 3: SPEAKING – lấy điểm từ SpeakingAttempt (AI đã chấm)
        if (
          question.skill === "speaking" ||
          question.type === "speaking"
        ) {
          const query = {
            question: question._id,
            student: req.user._id,
          };

          if (testId) query.exam = testId;
          if (mockExamId) query.exam = mockExamId;

          const attempt = await SpeakingAttempt.findOne(query)
            .sort({ createdAt: -1 });

          if (!attempt) {
            evaluatedAnswers.push({
              ...baseInfo,
              questionText: question.content,
              answer: "",
              correct: "(chưa có bài nói để chấm)",
              isCorrect: false,
              subIndex: null,
              aiScore: 0,
              aiMax: 0,
            });
            continue;
          }

          const aiScore = Number(attempt.score ?? 0);
          const aiMaxRaw =
            attempt.aiRawResult &&
              typeof attempt.aiRawResult.maxScore === "number"
              ? attempt.aiRawResult.maxScore
              : 0;

          const aiMax = aiMaxRaw > 0 ? aiMaxRaw : 1;

          totalItems += aiMax;
          totalCorrectItems += aiScore;

          skillStats[skillKey].total += aiMax;
          skillStats[skillKey].correct += aiScore;

          evaluatedAnswers.push({
            ...baseInfo,
            questionText: question.content,
            answer: attempt.transcript || "",
            correct: "(chấm bởi AI)",
            isCorrect: false,
            subIndex: null,
            aiScore,
            aiMax,
          });

          continue;
        }

        // CASE 4: các câu thường khác
        totalItems += 1;

        const userNorm = normalize(ans.answer);
        let isCorrect = false;
        let correctText = "";

        if (Array.isArray(question.answer)) {
          const correctArr = question.answer
            .map((v) => normalize(v))
            .filter(Boolean);
          if (userNorm && correctArr.includes(userNorm)) {
            isCorrect = true;
          }
          correctText = question.answer.join(" / ");
        } else {
          const correctNorm = normalize(question.answer);
          if (correctNorm && userNorm && correctNorm === userNorm) {
            isCorrect = true;
          }
          correctText = question.answer ?? "";
        }

        if (isCorrect) {
          totalCorrectItems += 1;
          skillStats[skillKey].correct += 1;
        }
        skillStats[skillKey].total += 1;

        evaluatedAnswers.push({
          ...baseInfo,
          questionText: question.content,
          answer: ans.answer ?? "",
          correct: correctText,
          isCorrect,
          subIndex: null,
        });
      } catch (e) {
        console.warn("Lỗi đánh giá câu hỏi:", e);
        continue;
      }
    }

    // Tính điểm thang 10
    let totalScore = 0;
    if (totalItems > 0) {
      totalScore = (totalCorrectItems * 10) / totalItems;
      totalScore = Math.round(totalScore * 100) / 100;
    }

    const details = Object.entries(skillStats).map(([skill, stat]) => {
      const accuracy = stat.total > 0 ? stat.correct / stat.total : 0;
      return {
        skill: skill || "unknown",
        score: Number((accuracy * 10).toFixed(2)),
        total: stat.total,
        accuracy,
      };
    });

    // 🔽 XÁC ĐỊNH TRƯỜNG / LỚP CHO KẾT QUẢ
    let schoolId = null;
    let classroomId = null;

    // 1) Ưu tiên: lấy từ Test (đề giáo viên tạo theo trường/lớp)
    if (testId) {
      const test = await Test.findById(testId)
        .select("school classroom")
        .lean();
      if (test) {
        schoolId = test.school || null;
        classroomId = test.classroom || null;
      }
    }

    // 2) Nếu là mockExam (đề thi thử) thì lấy trường/lớp từ MockExam
    if ((!schoolId || !classroomId) && mockExamId) {
      const mock = await MockExam.findById(mockExamId)
        .select("school classroom")
        .lean();
      if (mock) {
        if (!schoolId) schoolId = mock.school || null;
        if (!classroomId) classroomId = mock.classroom || null;
      }
    }

    // 3) Nếu có classroom nhưng chưa có school → lấy school từ Classroom
    if (!schoolId && classroomId) {
      const cls = await Classroom.findById(classroomId)
        .select("school")
        .lean();
      if (cls && cls.school) {
        schoolId = cls.school;
      }
    }

    // 4) fallback cuối cùng: lấy từ user (nếu vẫn thiếu)
    if (!schoolId || !classroomId) {
      const student = await User.findById(req.user._id)
        .select("school classroom")
        .lean();
      if (student) {
        if (!schoolId) schoolId = student.school || null;
        if (!classroomId) classroomId = student.classroom || null;
      }
    }


    const result = await Result.create({
      user: req.user._id,
      test: testId || null,
      mockExam: mockExamId || null,
      answers: evaluatedAnswers,
      score: totalScore,
      timeSpent: timeSpent || 0,
      details,
      school: schoolId || null,       // 👈 lưu trường
      classroom: classroomId || null, // 👈 lưu lớp
    });


    const populated = await result.populate([
      { path: "test", select: "title duration" },
      {
        path: "mockExam",
        select: "name officialName examType grade year duration",
      },
    ]);
    const r = populated || result;

    const examTitle =
      r.test?.title ||
      r.mockExam?.officialName ||
      r.mockExam?.name ||
      "Bài thi";

    const io = req.app.get("io");
    if (io) {
      const payload = {
        userId: req.user._id,
        userName: req.user.name,
        examId: testId || mockExamId,
        examTitle,
        score: totalScore,
        maxScore: 10,
        finishedAt: result.createdAt,
        resultId: result._id,
      };

      console.log(">>> EMIT admin_exam_finished:", payload);
      io.to("teachers").emit("admin_exam_finished", payload);
      io.emit("admin_exam_finished", payload);
    }

    res.status(201).json({
      _id: result._id,
      user: req.user._id,
      test: result.test,
      mockExam: result.mockExam,
      answers: evaluatedAnswers,
      score: totalScore,
      timeSpent: result.timeSpent,
      finishedAt: result.createdAt,
      details: result.details,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Lỗi server khi lưu kết quả" });
  }
});

// ============================
// GET /api/results/me
// ============================
router.get(
  "/me",
  verifyToken,
  verifyRole(["student"]),
  async (req, res) => {
    try {
      const { classroomId, onlyCurrentClass } = req.query;

      const filter = { user: req.user._id };

      if (classroomId) {
        // xem lịch sử của lớp cụ thể
        filter.classroom = classroomId;
      } else if (onlyCurrentClass === "true") {
        // chỉ xem lịch sử của lớp hiện tại trong hồ sơ
        const me = await User.findById(req.user._id).select("classroom");
        if (me?.classroom) {
          filter.classroom = me.classroom;
        } else {
          // ví dụ bài tự luyện không gắn lớp
          filter.classroom = null;
        }
      }
      // nếu không gửi gì -> giữ nguyên behavior cũ: lấy tất cả

      const results = await Result.find(filter)
        .populate("test", "title duration")
        .populate(
          "mockExam",
          "name officialName examType grade year duration"
        )
        .sort({ createdAt: -1 });

      const formatted = results.map((r) => ({
        _id: r._id,
        test: r.test || null,
        mockExam: r.mockExam || null,
        score: r.score ?? 0,
        timeSpent: r.timeSpent ?? 0,
        finishedAt: r.createdAt,
        details: Array.isArray(r.details)
          ? r.details.map((d) => ({
              skill: d.skill,
              score: d.score,
              total: d.total,
              accuracy: d.accuracy,
            }))
          : [],
      }));

      res.json(formatted);
    } catch (err) {
      console.error(err);
      res
        .status(500)
        .json({ message: "Lỗi server khi lấy kết quả cá nhân" });
    }
  }
);


// ============================
// GET /api/results/user/:userId
// ============================
router.get(
  "/user/:userId",
  verifyToken,
  verifyRole(["teacher", "admin", "school_manager"]),
  async (req, res) => {
    try {
      const filter = { user: req.params.userId };

      // admin: xem tất cả; teacher / school_manager: chỉ trong trường của mình
      if (req.user.role === "teacher" || req.user.role === "school_manager") {
        if (!req.user.school) {
          return res
            .status(400)
            .json({ message: "Tài khoản chưa được gán trường" });
        }
        filter.school = req.user.school;
      }

      const results = await Result.find(filter)
        .populate("test", "title duration")
        .sort({ createdAt: -1 });

      res.json(results);
    } catch (err) {
      console.error(err);
      res
        .status(500)
        .json({ message: "Lỗi server khi lấy kết quả học sinh" });
    }
  }
);

// ============================
// GET /api/results/test/:testId
// ============================
router.get(
  "/test/:testId",
  verifyToken,
  verifyRole(["teacher", "admin", "school_manager"]),
  async (req, res) => {
    try {
      const filter = { test: req.params.testId };

      if (req.user.role === "teacher" || req.user.role === "school_manager") {
        if (!req.user.school) {
          return res
            .status(400)
            .json({ message: "Tài khoản chưa được gán trường" });
        }
        filter.school = req.user.school;
      }

      const results = await Result.find(filter)
        .populate("user", "name email school classroom")
        .sort({ createdAt: -1 });

      res.json(results);
    } catch (err) {
      console.error(err);
      res
        .status(500)
        .json({ message: "Lỗi server khi lấy kết quả bài test" });
    }
  }
);

// ============================
// GET /api/results/me/skill-stats
// ============================
router.get(
  "/me/skill-stats",
  verifyToken,
  verifyRole(["student"]),
  async (req, res) => {
    try {
      const results = await Result.find({ user: req.user._id });
      if (!results.length) return res.json({});

      const skillStats = {};

      results.forEach((r) => {
        if (Array.isArray(r.details)) {
          r.details.forEach((d) => {
            if (!skillStats[d.skill])
              skillStats[d.skill] = { total: 0, correct: 0 };
            skillStats[d.skill].total += d.total;
            skillStats[d.skill].correct += d.score;
          });
        }
      });

      Object.keys(skillStats).forEach((skill) => {
        skillStats[skill].accuracy =
          skillStats[skill].total > 0
            ? Math.round(
              (skillStats[skill].correct /
                (skillStats[skill].total * 10)) *
              100
            ) / 100
            : 0;
      });

      res.json(skillStats);
    } catch (err) {
      console.error(err);
      res
        .status(500)
        .json({ message: "Lỗi khi thống kê skill của học sinh" });
    }
  }
);

// ============================
// GET /api/results/system/skill-stats
// ============================
router.get(
  "/system/skill-stats",
  verifyToken,
  verifyRole(["admin", "teacher", "school_manager"]),
  async (req, res) => {
    try {
      const query = {};

      // admin xem tất cả; teacher / school_manager chỉ trường mình
      if (req.user.role !== "admin") {
        if (!req.user.school) {
          return res
            .status(400)
            .json({ message: "Tài khoản chưa được gán trường" });
        }
        query.school = req.user.school;
      }

      const results = await Result.find(query, "answers");

      if (!results.length) {
        return res.json({});
      }

      const skillStats = {};

      results.forEach((r) => {
        if (!Array.isArray(r.answers)) return;

        r.answers.forEach((a) => {
          const skill = a.skill || "unknown";

          if (!skillStats[skill]) {
            skillStats[skill] = {
              totalQuestions: 0,
              correctQuestions: 0,
            };
          }

          skillStats[skill].totalQuestions += 1;
          if (a.isCorrect) {
            skillStats[skill].correctQuestions += 1;
          }
        });
      });

      const response = {};

      Object.entries(skillStats).forEach(([skill, stat]) => {
        const { totalQuestions, correctQuestions } = stat;
        const accuracy =
          totalQuestions > 0 ? correctQuestions / totalQuestions : 0;

        response[skill] = {
          totalQuestions,
          correctQuestions,
          accuracy: Number((accuracy * 100).toFixed(1)),
          avgScore: Number((accuracy * 10).toFixed(2)),
        };
      });

      res.json(response);
    } catch (err) {
      console.error("Lỗi thống kê skill:", err);
      res.status(500).json({
        message: "Lỗi server khi thống kê kỹ năng",
      });
    }
  }
);
/* =========================
  📊 10. Thống kê theo TRƯỜNG
  ========================= */
  router.get(
    "/stats/school/:schoolId",
    verifyToken,
    verifyRole(["admin", "teacher", "school_manager"]),
    async (req, res) => {
      try {
        const { schoolId } = req.params;
        const { year } = req.query;
  
        // ràng buộc quyền như cũ...
        if (req.user.role !== "admin") {
          if (!req.user.school) {
            return res
              .status(400)
              .json({ message: "Tài khoản chưa được gán trường" });
          }
          if (req.user.school.toString() !== schoolId.toString()) {
            return res
              .status(403)
              .json({ message: "Không có quyền xem thống kê trường này" });
          }
        }
  
        const filter = { school: schoolId };
        if (year) {
          const y = Number(year);
          if (!Number.isNaN(y)) {
            const start = new Date(y, 0, 1);
            const end = new Date(y + 1, 0, 1);
            filter.createdAt = { $gte: start, $lt: end };
          }
        }
  
        const results = await Result.find(filter)
          .populate({
            path: "user",
            select: "name email classroom",
            populate: {
              path: "classroom",
              select: "name code",          // 👈 lấy luôn tên + mã lớp
            },
          })
          .populate("test", "title")
          .sort({ createdAt: -1 });
  
        if (!results.length) {
          return res.json({
            schoolId,
            totalResults: 0,
            totalStudents: 0,
            avgScore: 0,
            minScore: 0,
            maxScore: 0,
            perTest: [],
            perStudent: [],
          });
        }
  
        const totalResults = results.length;
        let totalScore = 0;
        let minScore = Number.POSITIVE_INFINITY;
        let maxScore = Number.NEGATIVE_INFINITY;
  
        const studentsSet = new Set();
        const perTestMap = new Map();
        const perStudentMap = new Map();
  
        results.forEach((r) => {
          const s = Number(r.score || 0);
          totalScore += s;
          if (s < minScore) minScore = s;
          if (s > maxScore) maxScore = s;
  
          if (r.user) {
            const sid = r.user._id.toString();
            studentsSet.add(sid);
  
            const cls = r.user.classroom; // đã populate
            const className = cls?.name || "";
            const classCode = cls?.code || "";
  
            if (!perStudentMap.has(sid)) {
              perStudentMap.set(sid, {
                studentId: r.user._id,
                studentName: r.user.name,
                studentEmail: r.user.email || "",
                className,          // 👈 lưu lớp
                classCode,
                count: 0,
                totalScore: 0,
                minScore: Number.POSITIVE_INFINITY,
                maxScore: Number.NEGATIVE_INFINITY,
              });
            }
            const st = perStudentMap.get(sid);
            st.count += 1;
            st.totalScore += s;
            if (s < st.minScore) st.minScore = s;
            if (s > st.maxScore) st.maxScore = s;
          }
  
          if (r.test) {
            const key = r.test._id.toString();
            if (!perTestMap.has(key)) {
              perTestMap.set(key, {
                testId: r.test._id,
                testTitle: r.test.title,
                count: 0,
                totalScore: 0,
              });
            }
            const item = perTestMap.get(key);
            item.count += 1;
            item.totalScore += s;
          }
        });
  
        const avgScore = totalScore / totalResults;
        const totalStudents = studentsSet.size;
  
        const perTest = Array.from(perTestMap.values()).map((t) => ({
          testId: t.testId,
          testTitle: t.testTitle,
          count: t.count,
          avgScore: Number((t.totalScore / t.count).toFixed(2)),
        }));
  
        const perStudent = Array.from(perStudentMap.values()).map((st) => ({
          studentId: st.studentId,
          studentName: st.studentName,
          studentEmail: st.studentEmail,
          className: st.className || "",       // 👈 trả về thêm
          classCode: st.classCode || "",
          count: st.count,
          avgScore: Number((st.totalScore / st.count).toFixed(2)),
          minScore: Number(st.minScore.toFixed(2)),
          maxScore: Number(st.maxScore.toFixed(2)),
        }));
  
        res.json({
          schoolId,
          totalResults,
          totalStudents,
          avgScore: Number(avgScore.toFixed(2)),
          minScore: Number(minScore.toFixed(2)),
          maxScore: Number(maxScore.toFixed(2)),
          perTest,
          perStudent,
        });
      } catch (err) {
        console.error("Lỗi thống kê theo trường:", err);
        res.status(500).json({ message: "Lỗi server khi thống kê theo trường" });
      }
    }
  );
  // =========================
// 📊 11. Thống kê theo LỚP
// =========================
router.get(
  "/stats/class/:classroomId",
  verifyToken,
  verifyRole(["admin", "teacher", "school_manager"]),
  async (req, res) => {
    try {
      const { classroomId } = req.params;
      const { year } = req.query; // 👈 lấy năm từ query

      // lấy info lớp để check quyền + thông tin trường
      const classroom = await Classroom.findById(classroomId)
        .select("school name code homeroomTeacher")
        .populate("school", "name code");

      if (!classroom) {
        return res.status(404).json({ message: "Không tìm thấy lớp" });
      }

      // lấy id trường, tên trường, mã trường
      const classroomSchoolId = classroom.school
        ? (classroom.school._id
            ? classroom.school._id.toString()
            : classroom.school.toString())
        : null;

      const schoolName =
        classroom.school && typeof classroom.school === "object"
          ? classroom.school.name
          : undefined;

      const schoolCode =
        classroom.school && typeof classroom.school === "object"
          ? classroom.school.code
          : undefined;

      // ràng buộc quyền theo role
      if (req.user.role !== "admin") {
        if (!req.user.school) {
          return res
            .status(400)
            .json({ message: "Tài khoản chưa được gán trường" });
        }

        // chỉ cần cùng trường là được, KHÔNG ép phải là GVCN
        if (classroomSchoolId !== req.user.school.toString()) {
          return res
            .status(403)
            .json({ message: "Không có quyền xem lớp thuộc trường khác" });
        }
      }

      // 👇 filter cơ bản
      const filter = { classroom: classroomId };

      // 👇 nếu có year thì lọc theo năm dương lịch
      if (year) {
        const y = parseInt(year, 10);
        if (!Number.isNaN(y)) {
          const start = new Date(y, 0, 1);
          const end = new Date(y + 1, 0, 1);
          filter.createdAt = { $gte: start, $lt: end };
        }
      }

      const results = await Result.find(filter)
        .populate("user", "name email")
        .populate("test", "title")
        .sort({ createdAt: -1 });

      if (!results.length) {
        return res.json({
          classroomId,
          classroomName: classroom.name,
          classroomCode: classroom.code,
          schoolName,
          schoolCode,
          totalResults: 0,
          totalStudents: 0,
          avgScore: 0,
          minScore: 0,
          maxScore: 0,
          perTest: [],
          perStudent: [],
        });
      }

      const totalResults = results.length;
      let totalScore = 0;
      let minScore = Number.POSITIVE_INFINITY;
      let maxScore = Number.NEGATIVE_INFINITY;

      const studentsSet = new Set();
      const perTestMap = new Map();
      const perStudentMap = new Map();

      results.forEach((r) => {
        const s = Number(r.score || 0);
        totalScore += s;
        if (s < minScore) minScore = s;
        if (s > maxScore) maxScore = s;

        if (r.user) {
          const sid = r.user._id.toString();
          studentsSet.add(sid);

          if (!perStudentMap.has(sid)) {
            perStudentMap.set(sid, {
              studentId: r.user._id,
              studentName: r.user.name,
              studentEmail: r.user.email || "",
              count: 0,
              totalScore: 0,
              minScore: Number.POSITIVE_INFINITY,
              maxScore: Number.NEGATIVE_INFINITY,
            });
          }
          const st = perStudentMap.get(sid);
          st.count += 1;
          st.totalScore += s;
          if (s < st.minScore) st.minScore = s;
          if (s > st.maxScore) st.maxScore = s;
        }

        if (r.test) {
          const key = r.test._id.toString();
          if (!perTestMap.has(key)) {
            perTestMap.set(key, {
              testId: r.test._id,
              testTitle: r.test.title,
              count: 0,
              totalScore: 0,
            });
          }
          const item = perTestMap.get(key);
          item.count += 1;
          item.totalScore += s;
        }
      });

      const avgScore = totalScore / totalResults;
      const totalStudents = studentsSet.size;

      const perTest = Array.from(perTestMap.values()).map((t) => ({
        testId: t.testId,
        testTitle: t.testTitle,
        count: t.count,
        avgScore: Number((t.totalScore / t.count).toFixed(2)),
      }));

      const perStudent = Array.from(perStudentMap.values()).map((st) => ({
        studentId: st.studentId,
        studentName: st.studentName,
        studentEmail: st.studentEmail,
        count: st.count,
        avgScore: Number((st.totalScore / st.count).toFixed(2)),
        minScore: Number(st.minScore.toFixed(2)),
        maxScore: Number(st.maxScore.toFixed(2)),
      }));

      res.json({
        classroomId,
        classroomName: classroom.name,
        classroomCode: classroom.code,
        schoolName,
        schoolCode,
        totalResults,
        totalStudents,
        avgScore: Number(avgScore.toFixed(2)),
        minScore: Number(minScore.toFixed(2)),
        maxScore: Number(maxScore.toFixed(2)),
        perTest,
        perStudent,
      });
    } catch (err) {
      console.error("Lỗi thống kê theo lớp:", err);
      res.status(500).json({ message: "Lỗi server khi thống kê theo lớp" });
    }
  }
);


export default router;
