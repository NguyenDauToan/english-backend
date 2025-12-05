import mongoose from "mongoose";

const schoolYearSchema = new mongoose.Schema(
  {
    // VD: "2024-2025"
    name: { type: String, required: true, unique: true, trim: true },

    // tuỳ chọn, sau dùng để thống kê / lọc theo thời gian
    startDate: { type: Date },
    endDate: { type: Date },

    isActive: { type: Boolean, default: true }, // cho phép ẩn năm cũ
  },
  { timestamps: true }
);

export default mongoose.model("SchoolYear", schoolYearSchema);
