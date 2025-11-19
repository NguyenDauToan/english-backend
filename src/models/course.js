import mongoose from "mongoose";

const courseSchema = new mongoose.Schema(
  {
    title: { type: String, required: true },
    description: String,
    category: {
      type: String,
      enum: ["grammar", "vocabulary", "reading", "listening"],
      required: true,
    },
    level: {
      type: String,
      enum: ["beginner", "intermediate", "advanced"],
      default: "beginner",
    },
    contentUrl: String, // link hoặc ID bài luyện tập
  },
  { timestamps: true }
);

const Course = mongoose.model("Course", courseSchema);
export default Course;
