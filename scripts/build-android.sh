#!/bin/sh
set -eu

script_dir=$(CDPATH= cd "$(dirname "$0")" && pwd)
repo_root=$(dirname "$script_dir")
android_dir="$repo_root/android-client"

if [ -n "${ANDROID_SDK_ROOT:-}" ]; then
    sdk_dir=$ANDROID_SDK_ROOT
elif [ -n "${ANDROID_HOME:-}" ]; then
    sdk_dir=$ANDROID_HOME
elif [ -d "${HOME:-}/Library/Android/sdk" ]; then
    sdk_dir="$HOME/Library/Android/sdk"
else
    printf '%s\n' 'Android SDK not found. Set ANDROID_SDK_ROOT to your SDK directory.' >&2
    exit 1
fi
if [ ! -d "$sdk_dir/platforms/android-35" ] || [ ! -d "$sdk_dir/build-tools" ]; then
    printf 'Android SDK is incomplete at %s; install Android platform 35 and build tools.\n' "$sdk_dir" >&2
    exit 1
fi

supports_gradle_java() {
    candidate_home=$1
    [ -x "$candidate_home/bin/java" ] || return 1
    candidate_major=$("$candidate_home/bin/java" -version 2>&1 | sed -n '1s/.*version "\([0-9][0-9]*\).*/\1/p')
    [ "$candidate_major" = 17 ] || [ "$candidate_major" = 21 ]
}

bundled_jdk='/Applications/Android Studio.app/Contents/jbr/Contents/Home'
if [ -n "${JAVA_HOME:-}" ] && supports_gradle_java "$JAVA_HOME"; then
    java_home_candidate=$JAVA_HOME
elif supports_gradle_java "$bundled_jdk"; then
    java_home_candidate=$bundled_jdk
else
    printf '%s\n' 'JDK 17 or 21 not found. Set JAVA_HOME or install Android Studio.' >&2
    exit 1
fi

export ANDROID_SDK_ROOT="$sdk_dir"
export JAVA_HOME="$java_home_candidate"
export PATH="$JAVA_HOME/bin:$PATH"
printf 'Using Android SDK: %s\nUsing Java: %s\n' "$ANDROID_SDK_ROOT" "$JAVA_HOME"
cd "$android_dir"
./gradlew :app:testDebugUnitTest :app:lintDebug :app:assembleDebug
