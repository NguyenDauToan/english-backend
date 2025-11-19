// src/models/examProgress.js
import mongoose from "mongoose";

const examProgressSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    test: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Test",
      default: null,
    },
    mockExam: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "MockExam",
      default: null,
    },

    // dữ liệu trạng thái
    answers: {
      type: [mongoose.Schema.Types.Mixed], // [{questionId, answer}] như bên FE
      default: [],
    },
    currentIndex: { type: Number, default: 0 },
    timeUsed: { type: Number, default: 0 },
    timeLeft: { type: Number, default: 0 },
  },
  { timestamps: true }
);

// một user chỉ có tối đa 1 progress cho mỗi bài
examProgressSchema.index(
  { user: 1, test: 1, mockExam: 1 },
  { unique: true, sparse: true }
);

export default mongoose.model("ExamProgress", examProgressSchema);
