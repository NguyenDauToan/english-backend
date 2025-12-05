import mongoose from "mongoose";

const speakingAttemptSchema = new mongoose.Schema(
  {
    question: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Question",
      required: true,
    },
    student: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    exam: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Test",
    },

    audioUrl: { type: String, required: true },
    transcript: { type: String },

    // điểm gốc 0–10 từ AI
    score: { type: Number, min: 0, max: 10 },

    // điểm thực sự của câu (chuyển đổi theo tổng số câu speaking)
    scoreWeighted: { type: Number },           // ví dụ 1 hoặc 2 điểm
    perQuestionPoint: { type: Number },        // tối đa cho 1 câu
    totalSpeakingQuestions: { type: Number },  // số câu speaking trong đề

    comment: { type: String },

    status: {
      type: String,
      enum: ["pending", "graded"],
      default: "pending",
    },

    aiGraded: { type: Boolean, default: false },
    aiRawResult: { type: mongoose.Schema.Types.Mixed },
  },
  { timestamps: true }
);

speakingAttemptSchema.index({ status: 1, question: 1, student: 1 });

export default mongoose.model("SpeakingAttempt", speakingAttemptSchema);
