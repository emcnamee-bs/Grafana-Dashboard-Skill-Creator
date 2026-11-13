FROM python:3-slim
WORKDIR /app
COPY app.py viewer.js flashcards.js ./
EXPOSE 8088
CMD ["python", "-u", "app.py"]
