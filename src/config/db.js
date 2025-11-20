import mongoose from "mongoose";

const connectDB = async () => {
  try {
    const conn = await mongoose.connect(process.env.MONGO_URI);
    console.log(`✅ MongoDB connected to ${conn.connection.name}`);
    return conn.connection;
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
};

export default connectDB;
  