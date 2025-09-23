// src/utils/jwt.js
import jwt from "jsonwebtoken";

export const generateJWT = (user) => {
  // user có thể là object profile Google hoặc thông tin user trong DB
  return jwt.sign(
    {
      id: user.id,
      email: user.emails?.[0]?.value, // nếu user Google profile
      name: user.displayName
    },
    process.env.JWT_SECRET,
    { expiresIn: "1d" } // thời hạn 1 ngày
  );
};
