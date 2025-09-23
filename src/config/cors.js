import cors from "cors";

const corsOptions = {
  origin: ["http://localhost:5173"], // cho phép React frontend gọi
  methods: ["GET", "POST", "PUT", "DELETE"],
  credentials: true, // nếu cần gửi cookie/token
};

export default cors(corsOptions);
