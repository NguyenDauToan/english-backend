import express from "express";
import User from "../models/user.js"; // dùng 'user' lowercase trùng import
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";

const router = express.Router();

// ---------------- Đăng ký ----------------
router.post("/register", async (req, res) => {
  try {
    const { name, email, password, role } = req.body;
    const existingUser = await User.findOne({ email });
    if (existingUser) return res.status(400).json({ message: "Email đã tồn tại" });

    const hashedPassword = await bcrypt.hash(password, 10);
    const newUser = await User.create({ name, email, password: hashedPassword, role });

    const { password: pw, ...userData } = newUser._doc;
    res.status(201).json({ message: "Đăng ký thành công", user: userData });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ---------------- Đăng nhập ----------------
router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    const foundUser = await User.findOne({ email });
    if (!foundUser) return res.status(400).json({ message: "Email không tồn tại" });

    const isMatch = await bcrypt.compare(password, foundUser.password);
    if (!isMatch) return res.status(400).json({ message: "Sai mật khẩu" });

    const token = jwt.sign(
      {
        id: foundUser._id,
        name: foundUser.name,
        email: foundUser.email,
        role: foundUser.role,
      },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );

    const { password: pw, ...userData } = foundUser._doc;
    res.json({ token, user: userData });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});


export default router;
