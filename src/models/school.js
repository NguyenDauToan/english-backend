// models/school.js
import mongoose from "mongoose";

const { Schema } = mongoose;

const schoolSchema = new Schema(
  {
    name: { type: String, required: true },
    code: { type: String, unique: true, sparse: true }, // mã trường (tuỳ)
    address: { type: String },

    // quản lý chính của trường (hiệu trưởng/quản trị)
    manager: {
      type: Schema.Types.ObjectId,
      ref: "User",
    },

    // danh sách giáo viên (tùy bạn có muốn lưu 2 chiều hay không)
    teachers: [
      {
        type: Schema.Types.ObjectId,
        ref: "User",
      },
    ],

    // danh sách lớp của trường
    classes: [
      {
        type: Schema.Types.ObjectId,
        ref: "Classroom",
      },
    ],
  },
  { timestamps: true }
);

export default mongoose.models.School || mongoose.model("School", schoolSchema);
