# 이미지 리사이즈 구현 방식 조사

요구사항: **가로 기준(px)으로 줄이거나 늘리고**, **비율 유지**, **스크립트/도구로 자동화**.

## 1. Python + Pillow (PIL)

- **개요**: `Pillow`는 PIL 포크로, `Image.resize()` / `Image.thumbnail()` 등으로 리사이즈 가능. `LANCZOS` 리샘플링으로 품질 대비 속도가 무난함.
- **장점**: 크로스 플랫폼, `pip`만으로 설치 가능, 코드가 짧고 유지보수 쉬움, JPEG/PNG/WebP 등 일반 포맷 지원.
- **단점**: 런타임에 Python과 가상환경(또는 시스템 패키지)이 필요.

## 2. ImageMagick (`magick` / `convert`)

- **개요**: CLI에서 `magick input.jpg -resize 800x output.jpg` 형태. `800x`는 가로 800px, 세로는 비율에 맞게 자동.
- **장점**: 매우 강력한 이미지 처리, 스크립트에서 한 줄로 호출하기 좋음.
- **단점**: 별도 바이너리 설치 필요; 환경마다 명령 이름(`magick` vs `convert`) 차이가 있을 수 있음.

## 3. macOS `sips`

- **개요**: macOS에 기본 포함. `sips -z height width`는 **둘 다 지정**해야 하므로, 비율 유지 리사이즈는 가로만 주고 세로를 계산한 뒤 호출하거나 `--resampleWidth` 등 옵션 조합이 필요.
- **장점**: 추가 설치 없음(맥 한정).
- **단점**: macOS 전용; 문서/옵션이 ImageMagick·Pillow보다 덜 직관적인 경우가 있음.

## 4. FFmpeg

- **개요**: `ffmpeg -i in.png -vf scale=800:-1 out.png`처럼 `scale` 필터로 가로 고정·세로 자동(-1).
- **장점**: 이미 영상/이미지 파이프라인에 쓰는 경우 재사용 쉬움.
- **단점**: 정적 이미지 전용 도구로는 과함; 설치 부담.

## 5. Node.js + sharp

- **개요**: libvips 기반으로 빠른 리사이즈.
- **장점**: 속도·메모리 효율이 좋음.
- **단점**: Node 런타임과 `npm` 의존.

## 결정

이번 프로젝트는 **Python + Pillow**로 구현한다.

- 의존성이 `requirements.txt`로 명확하고, **Windows / macOS / Linux**에서 동일하게 동작하기 쉽다.
- 가로만 받아 세로를 `round(원본세로 * (목표가로 / 원본가로))`로 계산하는 로직을 코드로 명시할 수 있어, “비율 유지” 요구와 잘 맞는다.

대안으로 **ImageMagick 한 줄**이나 **FFmpeg `scale=WIDTH:-1`**도 동일 요구를 만족하므로, CLI만 선호하면 그쪽을 선택해도 된다.

## 스크립트 실행 예

구현 스크립트 `resize_image.py`는 프로젝트 폴더에 직접 넣어 둔 **`image_example.jpeg`**를 입력으로 쓸 수 있다.

```bash
python resize_image.py image_example.jpeg 400
```

기본 출력 파일명은 `image_example_w400.jpeg` 형태다.
