import whisper
import torch
import sys
import json

audio_path = sys.argv[1]

# CHỌN MODEL:
# - "base.en": khá nhanh, chính xác tốt cho bài nói ngắn
# - "small.en" hoặc "medium.en": chính xác hơn nhưng chậm hơn
MODEL_NAME = "base.en"   # bạn có thể đổi thành "small.en" hoặc "medium.en"

print(f"[Whisper] Using model: {MODEL_NAME}", file=sys.stderr)
model = whisper.load_model(MODEL_NAME)

# Nếu có GPU thì dùng fp16, không thì để False cho chắc
use_fp16 = torch.cuda.is_available()

try:
    result = model.transcribe(
        audio_path,
        task="transcribe",                 # chỉ nhận dạng, không dịch
        language="en",                     # ép tiếng Anh
        temperature=0.0,                   # hạn chế random
        condition_on_previous_text=False,  # không dựa vào câu trước để bịa
        beam_size=5,                       # beam search cho chính xác hơn
        best_of=5,                         # thử nhiều câu trả lời, chọn tốt nhất
        fp16=use_fp16,
        verbose=False,
    )

    transcript = result.get("text", "").strip()

    # Nếu muốn giới hạn độ dài để tránh bị lố
    max_len = 400
    if len(transcript) > max_len:
        transcript = transcript[:max_len]

except Exception as e:
    transcript = ""
    print(json.dumps({"error": str(e)}))
    sys.exit(1)

print(json.dumps({
    "transcript": transcript
}))
