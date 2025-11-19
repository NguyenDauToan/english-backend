import mongoose from "mongoose";

const skillSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, unique: true }, // ví dụ: reading
    displayName: { type: String, required: true },        // ví dụ: Đọc hiểu
    description: { type: String },
    examCount: { type: Number, default: 0 },
  },
  { timestamps: true }
);

const Skill = mongoose.model("Skill", skillSchema);
export default Skill;
