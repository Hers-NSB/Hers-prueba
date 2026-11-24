#!/usr/bin/env bash
set -euo pipefail
# Called from the repository root on Ubuntu with MinGW and NASM installed.
encoder_root="$PWD/vendor/encoder"
prefix_root="$PWD/vendor/encoder-prefix"
mkdir -p "$encoder_root" "$prefix_root"
(
  cd third_party/x264
  ./configure --host=x86_64-w64-mingw32 --cross-prefix=x86_64-w64-mingw32- \
    --prefix="$prefix_root" --enable-static --disable-cli --disable-opencl \
    --bit-depth=8 --chroma-format=420 --extra-ldflags=-static
  make -j2
  make install
)
(
  cd third_party/ffmpeg
  PKG_CONFIG_LIBDIR="$prefix_root/lib/pkgconfig" ./configure \
    --target-os=mingw32 --arch=x86_64 --cross-prefix=x86_64-w64-mingw32- \
    --enable-cross-compile --pkg-config=pkg-config --pkg-config-flags=--static \
    --prefix="$encoder_root" --disable-autodetect --disable-everything \
    --disable-doc --disable-debug --disable-network --disable-ffprobe --disable-ffplay \
    --enable-small --enable-gpl --enable-libx264 --enable-encoder=libx264,rawvideo \
    --enable-decoder=mjpeg --enable-demuxer=concat,image2,jpeg_pipe --enable-parser=mjpeg --enable-muxer=mp4,rawvideo \
    --enable-protocol=file,pipe --enable-filter=scale,format,fps,trim,setpts,null,crop \
    --extra-cflags="-Os -I$prefix_root/include" --extra-ldflags="-static -L$prefix_root/lib"
  make -j2 ffmpeg.exe
  x86_64-w64-mingw32-strip ffmpeg.exe
  cp ffmpeg.exe "$encoder_root/ffmpeg.exe"
)
cp third_party/ffmpeg/COPYING.GPLv2 "$encoder_root/FFmpeg-LICENSE.txt"
cp third_party/x264/COPYING "$encoder_root/x264-LICENSE.txt"
