// scripts/fixPlainPasswords.js
import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import User from "../models/user.js";

async function main() {
  await mongoose.connect(process.env.MONGO_URI);

  const users = await User.find({}); // hoặc { role: "teacher" } nếu chỉ fix giáo viên
  for (const u of users) {
    if (!u.password.startsWith("$2")) {  // rất thô nhưng đủ dùng: chưa hash
      const hashed = await bcrypt.hash(u.password, 10);
      u.password = hashed;
      await u.save();
      console.log("Fixed password for:", u.email);
    }
  }

  await mongoose.disconnect();
}

main().catch(console.error);
