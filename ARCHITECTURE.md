# KANTAN Play Core アーキテクチャガイド

## 概要

KANTAN Play Core（かんぷれ）は、M5Stack Core2 / CoreS3 で動作するオープンソース音楽ガジェットのファームウェアです。
専用ハードウェア「KANTAN Play base」（スイッチ・MIDI音源・アンプ・バッテリー・各種インターフェースを搭載）と組み合わせて使用します。

**技術スタック**: C++17 / Arduino + ESP-IDF / FreeRTOS / M5Unified / PlatformIO

## 入口ガイド

AI エージェントや開発者が最初に見るべき情報を、追従コストの低い内容だけに絞ってまとめます。

### 最初に見るファイル

| ファイル | 用途 |
|---|---|
| `main/main.cpp` | 起動順、タスク生成順、起動失敗条件の確認 |
| `main/system_registry.hpp` | 共有状態の入口。設定、ランタイム情報、キューの定義 |
| `main/common_define.hpp` | コマンド種別、定数、列挙値の確認 |
| `.claude/structure_map.md` | 巨大ファイルの入口。関数名ベースで当たりを付ける |
| `platformio.ini` | ビルド環境、ターゲット、使用フレームワークの確認 |

### 代表的な作業の逆引き

| やりたいこと | 主に見るファイル |
|---|---|
| 演奏ロジックを変える | `main/task_kantanplay.cpp`, `main/task_operator.cpp`, `main/common_define.hpp` |
| ボタン入力や割り当てを変える | `main/task_commander.cpp`, `main/task_operator.cpp`, `main/system_registry.cpp` |
| 画面表示や UI を変える | `main/gui.cpp`, `main/gui/*.inl` |
| メニュー項目を追加・変更する | `main/menu_data.cpp`, `main/menu_data/*.inl` |
| MIDI 周りを修正する | `main/task_midi.cpp`, `main/midi/*` |
| WiFi / OTA を修正する | `main/task_wifi.cpp`, `main/task_http_client.cpp`, `incbin/html/*` |
| 設定保存やレジュームを修正する | `main/system_registry.cpp`, `main/file_manage.cpp` |

### 編集時の基本ルール

- `main/kantan-music/` はプリコンパイル済みライブラリのため編集しない
- `main/resource_icon.cpp` は自動生成データのため手動編集しない
- 新しいグローバル状態は増やさず、共有状態は `system_registry` 経由で扱う
- 巨大ファイルを読むときは、まず `.claude/structure_map.md` で責務と関数位置を確認する
- 詳細な実装説明書より、責務の分離と命名整理を優先する

## ディレクトリ構成

```
KANTAN_Play_core/
├── main/                       # アプリケーションソース (C++ 約29,000行)
│   ├── gui/                    #   GUI描画 (.inl×8)
│   ├── menu_data/              #   メニュー定義 (.inl×5)
│   ├── midi/                   #   MIDIドライバ (BLE / UART / USB)
│   ├── ex_i2c/                 #   外部I2Cデバイス (M5 Byte Button, ExtIO2)
│   ├── in_i2c/                 #   内部I2Cデバイス (BMI270, ES8388, SI5351)
│   └── kantan-music/           #   KANTAN Music API (プリコンパイル済み・編集不可)
│       ├── esp32/ m1mac/ x86/  #     プラットフォーム別バイナリ
│       └── include/            #     ヘッダーファイル
├── incbin/                     # 組み込みリソース
│   ├── html/                   #   Web UI (main.html, wifi.html)
│   └── preset/                 #   音楽プリセット (JSON)
├── 3d/                         # 3D CADデータ
├── ota_bin/                    # OTA更新用ファームウェア履歴
├── docs/                       # GitHub Pages (ESP Web Tools書き込みページ)
├── platformio.ini              # PlatformIOビルド設定
└── LICENSE                     # MITライセンス
```

## ビルド環境

PlatformIO がメインビルドシステム。デフォルト環境は `release_s3`（M5Stack CoreS3 リリースビルド）。

| 環境名 | ターゲット | フレームワーク | 用途 |
|---|---|---|---|
| `release_s3` | ESP32-S3 (CoreS3) | Arduino | **CoreS3リリースビルド（デフォルト）** |
| `release` | ESP32 (Core2) | Arduino | Core2リリースビルド |
| `esp32s3_arduino` | ESP32-S3 (CoreS3) | Arduino | CoreS3デバッグビルド |
| `esp32_arduino` | ESP32 (Core2) | Arduino | Core2デバッグビルド |
| `esp32_idf` | ESP32 | ESP-IDF | IDF直接ビルド |
| `native_x86` | x86 | ネイティブ (SDL2) | PC上での開発・デバッグ |
| `native_linux` | Linux x86 | ネイティブ (SDL2) | Linux上での開発・デバッグ |
| `native_m1mac` | ARM64 | ネイティブ (SDL2) | Mac (Apple Silicon) 開発・デバッグ |

ネイティブビルド（`native_*`）は SDL2 を利用して PC 上でファームウェアの動作確認ができます。

**主な依存ライブラリ**: M5Unified, ArduinoJson (^7.3.0), kantan-music (プリコンパイル済み)

### よく使うコマンド

```bash
# CoreS3 リリースビルド
pio run -e release_s3

# Apple Silicon Mac 上でのネイティブビルド
pio run -e native_m1mac

# Core2 デバッグビルド
pio run -e esp32_arduino
```

> **Note**: `~/.platformio` への書き込みが制限される環境では、`PLATFORMIO_CORE_DIR=/tmp/pio-kantanplay` を先頭に付けて実行してください。

## アーキテクチャ

### FreeRTOS マルチタスク構成

全タスクは `xTaskCreatePinnedToCore()` で生成され、中央レジストリ `system_registry` を共有します。

```
┌──────────────────────────────────────────────────────────────┐
│  system_registry_t（中央レジストリ・全タスクで共有）          │
│  ├─ user_setting       ユーザー設定（永続化対象）            │
│  ├─ runtime_info       実行時情報（バッテリー、WiFi等）      │
│  ├─ operator_command   commander → operator コマンドキュー   │
│  ├─ player_command     operator → kantanplay コマンドキュー  │
│  ├─ working_command    現在有効なコマンド                     │
│  ├─ song_data          演奏データ（8スロット）                │
│  ├─ control_mapping    ボタン→コマンドのマッピング            │
│  └─ task_status        各タスクの動作状態                     │
└──────────────────────────────────────────────────────────────┘
```

### データフロー（ユーザー入力 → 演奏出力）

```
ボタン押下
  → task_commander（入力検出・マッピング解決）
    → operator_command キュー + xTaskNotify()
      → task_operator（UI状態更新・LED色制御）
        → player_command キュー + xTaskNotify()
          → task_kantanplay（度数確定・ステップ進行・MIDI出力）
            → task_midi（BLE/UART/USB送信）
            → task_i2s（オーディオ出力）
```

### タスク間通信

- **xTaskNotify()**: タスク起動通知
- **レジストリ履歴**: `registry_base_t` の履歴キューによる順序保証された変更通知
- **ミューテックス**: `std::mutex` による `working_command` の排他制御

## 主要モジュール

### タスク一覧

| タスク | ファイル | 役割 |
|---|---|---|
| `kanplay` | `task_kantanplay.cpp` | メイン演奏エンジン（コード演奏・ビート管理・自動演奏） |
| `operator` | `task_operator.cpp` | UI状態管理・LED色制御・コマンドルーティング |
| `command` | `task_commander.cpp` | ボタン入力検出・コマンドマッピング解決 |
| `midi` | `task_midi.cpp` | MIDI入出力の統合管理 |
| `spi` | `task_spi.cpp` | ディスプレイ描画・SDカードアクセス |
| `i2c` | `task_i2c.cpp` | センサー・ハードウェアI2C制御 |
| `i2s` | `task_i2s.cpp` | オーディオI/O（ES8388 DAC） |
| `wifi` | `task_wifi.cpp` | WiFi接続・OTAアップデート |
| `httpcl` | `task_http_client.cpp` | HTTPクライアント（OTA・Web通信） |
| `port_a` | `task_port_a.cpp` | 外部ポートA デバイス制御 |
| `port_b` | `task_port_b.cpp` | 外部ポートB 入力処理 |

### GUI システム

`gui.cpp` から 8つの `.inl` ファイルを `#include` する構成です。

| ファイル | 内容 |
|---|---|
| `gui/gui_base.inl` | UI基底クラス (`ui_base_t`, `ui_container_t`)、色操作ユーティリティ |
| `gui/gui_buttons.inl` | メインボタン・サブボタンの描画 |
| `gui/gui_info.inl` | バッテリー・WiFi・MIDIポート等の情報表示 |
| `gui/gui_menu.inl` | メニュー画面の描画 |
| `gui/gui_misc.inl` | 波形表示、GUI初期化、描画メインループ、タッチ入力処理 |
| `gui/gui_partinfo.inl` | パート情報・アルペジエーター編集 |
| `gui/gui_popup.inl` | ポップアップ通知・QRコード表示 |
| `gui/gui_sequence.inl` | シーケンスタイムライン |

### メニューシステム

`menu_data.cpp` から 5つの `.inl` ファイルを `#include` する構成です。50種以上のメニュー項目クラスを定義しています。

| ファイル | 内容 |
|---|---|
| `menu_data/menu_data_base.inl` | メニュー基底クラス (`mi_tree_t`, `mi_normal_t`) |
| `menu_data/menu_data_system.inl` | システム設定（言語・明るさ・ボリューム・Webサーバ等） |
| `menu_data/menu_data_part.inl` | パート設定（音色・オクターブ・ボイシング・シーケンス等） |
| `menu_data/menu_data_midi.inl` | MIDI設定（テンポ・MIDIポート・OTA・ファイル操作等） |
| `menu_data/menu_data_arrays.inl` | メニュー配列定義 (`MENU_BUILDER` マクロ) |

### MIDI ドライバ

`midi/` フォルダにトランスポート層が分離されています。

| ファイル | 内容 |
|---|---|
| `midi/midi_driver.cpp/hpp` | MIDI ドライバ統合インターフェース |
| `midi/midi_transport_ble.cpp/hpp` | Bluetooth LE MIDI |
| `midi/midi_transport_uart.cpp/hpp` | UART MIDI（DIN-5コネクタ） |
| `midi/midi_transport_usb.cpp/hpp` | USB MIDI（ホスト/デバイス両対応） |

## .inl ファイルパターン

本プロジェクトでは、巨大になるソースファイルを `.inl`（インラインファイル）に分割する設計パターンを採用しています。

```cpp
// gui.cpp（親ファイル - ヘッダ・定数・#include のみ）
#include "gui.hpp"
// ... 定数定義 ...
#include "gui/gui_base.inl"
#include "gui/gui_popup.inl"
#include "gui/gui_info.inl"
// ... 以下同様 ...
```

`.inl` ファイルは独立したコンパイル単位ではなく、親の `.cpp` に `#include` されることで一つの翻訳単位を構成します。
`gui.cpp` と `menu_data.cpp` がこのパターンを使用しています。

## 注意事項

- **`main/kantan-music/`**: プリコンパイル済みライブラリです。**編集不可**、逆コンパイル禁止。リポジトリ本体とは別ライセンスです（詳細は `main/kantan-music/LICENSE_KANTAN_MUSIC.md` を参照）。
- **`main/resource_icon.cpp`**: 自動生成されたアイコンリソースデータ（約22,000行）です。手動編集しないでください。
- **タスク間通信**: `xTaskNotify()` + レジストリ履歴で行います。タスクをまたぐ直接的な関数呼び出しはスレッド安全性に注意してください。
- **グローバル状態**: `system_registry` 経由でアクセスします。直接的なグローバル変数の追加は避けてください。

## 巨大ファイルとの付き合い方

巨大ファイルは、まず文書で入口を絞ってから必要箇所だけ読む方が保守負荷を抑えられます。詳細な行番号表や read/write 一覧を増やすより、責務単位で見通しを良くする方針を推奨します。

- `task_kantanplay.cpp`: 演奏ロジックの中心。演奏タイミングやステップ進行を扱う
- `task_operator.cpp`: コマンド解決と UI 状態遷移の中心
- `system_registry.cpp`: 保存、レジューム、CRC、設定同期の中心
- `gui/*.inl`, `menu_data/*.inl`: 既に責務単位で分割済み。まずこちらの分割パターンを踏襲する

将来的に分割する場合も、先に責務境界を明確にし、既存の `.inl` パターンを踏襲できる箇所から進めるのが安全です。

## コーディング規約

| 項目 | 規則 |
|---|---|
| インデント | スペース2文字 |
| ブレーススタイル | K&R（制御文・関数とも同行に開き括弧） |
| クラス/構造体名 | `snake_case` + `_t` サフィックス（例: `ui_base_t`, `task_operator_t`） |
| メンバ変数 | `_` プレフィックス + `snake_case`（例: `_current_usec`） |
| ローカル変数・関数名 | `snake_case` |
| 定数/enum値 | `UPPER_CASE` または `snake_case` |
| 列挙型 | `enum class` を使用 |
| 名前空間 | `kanplay_ns`（内部に `def::lang`, `def::midi` 等） |
| ポインタ/参照 | 型側に付ける（`int* p`, `int& ref`） |
| コメント | `//` スタイル |
| ファイルヘッダ | `// SPDX-License-Identifier: MIT` / `// Copyright (c) 2025 InstaChord Corp.` |

## ライセンス

- **リポジトリ全体**: MIT License (Copyright 2025 InstaChord Corp.)
- **`main/kantan-music/`**: 独自ライセンス — 利用無料だが「KANTAN Music 準拠」の明記と InstaChord への報告が必要。1,000台以上のハードウェア生産時は $1 USD/台のライセンス料が発生。詳細は `main/kantan-music/LICENSE_KANTAN_MUSIC.md` を参照。
