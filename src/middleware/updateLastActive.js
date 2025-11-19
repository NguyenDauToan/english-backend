// middleware/updateLastActive.js
import User from "../models/user.js";

export const updateLastActive = async (req, res, next) => {
  try {
    if (req.user?._id) {
      await User.findByIdAndUpdate(req.user._id, { lastActive: new Date() });
    }
  } catch (err) {
    console.error("Không thể cập nhật lastActive:", err);
  }
  next();
};
