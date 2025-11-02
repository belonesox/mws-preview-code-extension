#!/bin/bash

# Настройка путей
SOURCE_DIR="./media"
TARGET_DIR="./docs/pics"
PNG_SIZE="32" # Размер в пикселях (32x32)

# --- Проверка наличия inkscape ---
if ! command -v inkscape &> /dev/null
then
    echo "Ошибка: Утилита 'inkscape' не найдена."
    echo "Пожалуйста, установите Inkscape (обычно 'sudo apt install inkscape' или через менеджер пакетов)."
    exit 1
fi

# --- Создание целевой директории, если она не существует ---
if [ ! -d "$TARGET_DIR" ]; then
    echo "Создание целевой директории: $TARGET_DIR"
    mkdir -p "$TARGET_DIR"
fi

echo "--- Начинаем конвертацию SVG в PNG (Размер: ${PNG_SIZE}x${PNG_SIZE}) ---"

# --- Цикл по всем SVG-файлам в исходной директории ---
find "$SOURCE_DIR" -maxdepth 1 -type f -name "*.svg" | while read SVG_FILE
do
    # Извлечение имени файла без расширения
    FILENAME=$(basename "$SVG_FILE" .svg)
    
    # Полный путь к целевому PNG-файлу
    TARGET_PNG="${TARGET_DIR}/${FILENAME}.png"

    echo "Конвертация: $SVG_FILE -> $TARGET_PNG"

    # --- Команда Inkscape ---
    # -w ${PNG_SIZE} -h ${PNG_SIZE}: Установка ширины и высоты в 32px
    # -o: Установка имени выходного файла
    # --export-filename: (Современный синтаксис Inkscape)
    inkscape -w "${PNG_SIZE}" -h "${PNG_SIZE}" "$SVG_FILE" --export-filename="$TARGET_PNG"

    if [ $? -ne 0 ]; then
        echo "!!! ОШИБКА конвертации $SVG_FILE. Проверьте файл."
    fi
done

echo "--- Конвертация завершена. Результаты находятся в $TARGET_DIR ---"