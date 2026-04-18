# 開発者向けメモ（Claude 用）

`SPEC.md` がプロダクト要件、こちらは「コードを触るときの注意点・背景」。

## ファイル構成

```
index.html        ボディ全体を組む。SPA だが 1 画面のみ
style.css         レイアウト、盤面、コマの見た目、アニメーション
script.js         ゲームロジック・履歴管理・DOM 更新（IIFE で完結）
package.json      テスト用 playwright のみ依存
tests/ipad.mjs    iPad Mini (WebKit) エミュレーションでの自動検証
```

外部ライブラリ・ビルドツールは持ち込まない。`script.js` は IIFE 1 個。

## ローカル起動と検証

```sh
# サーバー起動（ポート 5173 固定で運用中。Playwright MCP もこのポートを向く）
npx --yes serve -p 5173 -L .

# スタンドアロンの自動検証（依存: npm i 済みであること）
node tests/ipad.mjs
```

`tests/ipad.mjs` は WebKit + iPad Mini プロファイルで開き、初期配置・着手・0.8s ゲート・フリップ・手数減算・ターン交代・page back/forward での undo/redo・無効クリック無視・盤の縦フィットを 21 アサーションで検証する。**仕様変更時はここも更新する。**

Playwright MCP（`mcp__playwright__*` ツール群）が利用可能なら、対話的検証はそちらで行ってよい。MCP は WebKit ではなく既定で Chromium を使う点に注意（iPad と同じレイアウトかは別途確認）。

## 設計の要点

### 状態

- すべて `script.js` の `state` オブジェクトに集約：`board[8][8]` (0=空 / 1=黒 / 2=白), `turn`, `handBlack`, `handWhite`, `gameOver`。
- 盤面の DOM はビルド時に 64 セルを 1 度生成し、その後は `.cell` 内の `.piece` 要素を生やす／消す／`data-color` を切り替えるだけ。フル再描画は popstate 復元時のみ (`snapRender`)。

### 履歴（page back/forward）

- 起動時 `boot()` で `history.replaceState({state: clone(initial)}, '')` を必ず呼ぶ。これをしないと、最初の戻り先が state なしのエントリになり popstate ハンドラが「無視」してしまうため、初手を戻したときに復元できなくなる。
- 着手完了時に `history.pushState({state: clone(state)}, '')` で 1 エントリ刻む。
- `popstate` ハンドラは `e.state.state` を読んで `snapRender()`。`snapRender()` は body に `.no-anim` を一瞬付けてトランジションを抑制してから付け替える。

### 着手アニメーションのタイミング（仕様 §6）

`performMove()` の流れ：

1. 即座にコマ DOM 追加 + `state.board` と `handX` 更新 + UI 反映。
2. `await sleep(800)` ← 仕様の「0.8 秒待つ」ゲート。
3. 各方向 (line) を `Promise.all` で並列起動し、line 内では `for` で 200ms 間隔。各石は `flipPieceAnimated()` を起点に「フリップアニメ開始」と同時に `state.board[fr][fc]` を更新。
4. 全 line のキックオフ完了 (= 最後のフリップが「始まった」瞬間) でターン切替・UI 更新・`pushState`。
5. 最後に `await sleep(450)` してアニメーション完了を待ち、`animating = false`。

**ポイント**: ターン切替を「最後のフリップ完了後」ではなく「最後のフリップ開始時」にしているのは、UI のアクティブ表示や次手のヒントを早めに出して操作感を良くするため。`animating` フラグだけはアニメーションが終わるまで真にしておき、二重着手を防ぐ。

### コマのフリップ表現（重要なハマり所）

最初は標準的な CSS 3D フリップ（`transform-style: preserve-3d` + `rotateY(180deg)` + `backface-visibility: hidden`）で書いた。**これは WebKit のヘッドレススクリーンショットで両面が同時に描画され、すべて白く写る（`backface-visibility` が screenshot レンダリング時に効かない）**。実機 Safari でどう見えるかも保証できないため、現在は 2D の擬似コインフリップに置き換え済み：

- `.piece` の `::before` に黒、 `::after` に白を重ねる。`opacity` で表示面を切り替え。
- 反転時は `.piece.flipping` を付与し `@keyframes coin-flip` (`scaleX: 1 → 0.05 → 1`) を再生。
- スクリプト側で `setTimeout(..., 225)` (= アニメーションの中点) に `data-color` を切替。

**復活させるなら**: 必ず WebKit の実機/エミュレーションで `browser_take_screenshot` してビジュアル確認すること。`getComputedStyle` の transform 値だけでは「両面表示バグ」を検出できない。

### 盤面のドット（星点）

`STAR_POINTS` は `'1,1','1,5','5,1','5,5'`。`::after` で対象セルの右下に置くことで「セル(1,1)・(1,5)・(5,1)・(5,5) の右下角」 = 「内側 4 箇所の格子点」を表現している。座標を増やしたり擬似要素の位置を変えるときは「セル右下＝内側交点」の対応関係を崩さないこと。

### iPad ポートレートのレイアウト前提

- 想定ビューポート: iPad Mini (768×1024) を最小ターゲット。それ以上の iPad (810×1080 等) でも崩れない CSS にしてある。
- 盤サイズは `min(92vw, calc(100vh - 260px))` の正方形。`260px` はプレイヤーパネル 2 段 + paddings の見込み値。プレイヤーパネルの高さを変更するならここも追従させる。
- `meta viewport` で `maximum-scale=1, user-scalable=no` を指定し、Safari のダブルタップズームを抑止している。

## 触るときの注意

- アプリにリセット UI は付けない（仕様）。
- `script.js` の `FLIP_DELAY_START_MS = 800`、`FLIP_INTERVAL_MS = 200` は仕様値。変える場合は `tests/ipad.mjs` の sleep もあわせて見直す。
- `state.handBlack` / `state.handWhite` の初期値は `30`（盤上 4 枚は手元 32 枚から 2 枚ずつ出した残）。
- `clone(state)` は浅すぎるとバグる（`board` が共有されると履歴が壊れる）。`script.js` の `clone()` は `board.map(row => row.slice())` で行コピーしている。新しい配列フィールドを足すときは `clone()` の更新を忘れないこと。
- 着手中（`animating === true`）はクリックも `popstate` も無視している。テストで連打する場合は十分に待つこと。

## 既知の非対応 / 意図的に持っていないもの

- マルチプレイヤー（オンライン対戦）
- 棋譜表示・盤面リプレイ（履歴は browser history に依拠）
- AI 対戦
- スコア表示（手元残数で代替）
- リセットボタン（仕様により故意に持たない）
