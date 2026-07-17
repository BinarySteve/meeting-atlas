#!/usr/bin/env bash
set -euo pipefail

SDK="${VULKAN_SDK_ROOT:-$HOME/opt/vulkan-sdk}"
mkdir -p "$SDK/debs" "$SDK/root"
cd "$SDK/debs"
apt-get download libvulkan-dev glslc libshaderc1 spirv-headers
for package in ./*.deb; do
  dpkg-deb -x "$package" "$SDK/root"
done
echo "User-space Vulkan SDK extracted to $SDK/root"
