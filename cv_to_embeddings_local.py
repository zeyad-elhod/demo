# cv_to_embeddings_local.py
# 100% LOCAL embeddings (no OpenAI, no internet required).

import json
from pathlib import Path
import fitz  # PyMuPDF
from sentence_transformers import SentenceTransformer


def load_pdf_text(pdf_path: Path) -> str:
    doc = fitz.open(pdf_path)
    pages = [page.get_text() for page in doc]
    doc.close()
    return "\n".join(pages)


def chunk_text(text: str, chunk_size: int = 500, overlap: int = 50) -> list[str]:
    text = text.strip()
    if not text:
        return []

    chunks = []
    start = 0
    n = len(text)

    while start < n:
        end = min(start + chunk_size, n)
        chunk = text[start:end].strip()
        if len(chunk) > 20:
            chunks.append(chunk)

        if end == n:
            break

        start = end - overlap
        if start < 0:
            start = 0

    return chunks


def main():
    pdf_path = Path("cv.pdf")
    if not pdf_path.exists():
        raise FileNotFoundError("cv.pdf not found in current folder.")

    print("📄 Reading cv.pdf...")
    text = load_pdf_text(pdf_path)

    print("✂️ Chunking text...")
    chunks = chunk_text(text)
    print(f"Total chunks: {len(chunks)}")

    print("🧠 Loading local embedding model (all-MiniLM-L6-v2)...")
    model = SentenceTransformer("sentence-transformers/all-MiniLM-L6-v2")

    data = []
    for i, chunk in enumerate(chunks, start=1):
        emb = model.encode(chunk).tolist()
        data.append({"id": i, "chunk_text": chunk, "embedding": emb})

        if i % 10 == 0 or i == len(chunks):
            print(f"Embedded {i}/{len(chunks)} chunks...")

    out_path = Path("cv_embeddings.json")
    out_path.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")

    print(f"✅ Done! Saved embeddings to {out_path.resolve()}")


if __name__ == "__main__":
    main()