// src/models/result.js
import mongoose from "mongoose";

const AnswerSchema = new mongoose.Schema(
  {
    // id câu hỏi gốc
    question: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Question",
      required: true,
    },
    questionText: { type: String, default: "" },

    // đáp án học sinh
    answer: { type: String, default: "" },

    // đáp án đúng (text)
    correct: { type: String, default: "" },

    isCorrect: { type: Boolean, default: false },

    skill: { type: String, default: "" },
    grade: { type: String, default: "" },
    type: { type: String, default: "" },

    // index câu con cho reading_cloze (0,1,2,...), bình thường = null
    subIndex: { type: Number, default: null },
  },
  { _id: false }
);

const DetailSchema = new mongoose.Schema(
  {
    skill: { type: String, default: "" },
    score: { type: Number, default: 0 },
    total: { type: Number, default: 0 },
    accuracy: { type: Number, default: 0 },
  },
  { _id: false }
);

const ResultSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    // bài test thường
    test: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Test",
      default: null,
    },

    // đề thi thử / THPTQG
    mockExam: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "MockExam",
      default: null,
    },

    // điểm thang 10
    score: { type: Number, required: true },

    // thời gian làm bài (giây)
    timeSpent: { type: Number, default: 0 },

    answers: { type: [AnswerSchema], default: [] },

    details: { type: [DetailSchema], default: [] },
  },
  { timestamps: true }
);

export default mongoose.models.Result || mongoose.model("Result", ResultSchema);
