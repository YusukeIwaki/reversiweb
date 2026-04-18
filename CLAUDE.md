# 開発者向けメモ（Claude 用）

`SPEC.md` がプロダクト要件、こちらは「コードを触るときの注意点・背景」。

## ファイル構成

```
index.html        ボディ全体を組む。SPA だが 1 画面のみ
style.css         レイアウト、盤面、コマの見た目、アニメーション
script.js         ゲームロジック・履歴管理・DOM 更新（IIFE で完結）
package.json      テスト・録画用 playwright のみ依存
tests/ipad.mjs    iPad Mini (WebKit) エミュレーションでの自動検証
tests/record.mjs  README.md 用 GIF 元動画 (webm) を録画するスクリプト
demo.gif         README.md に貼ってある動作デモ。**git 管理対象**
```

外部ライブラリ・ビルドツールは持ち込まない。`script.js` は IIFE 1 個。

`.gitignore` の対象（コミットしない）:
- `node_modules/`
- `tests/videos/`（録画の生成物。webm はリポジトリに含めない）
- `tests/screenshots/`（テスト時の中間生成物）
- `.playwright-mcp/`（Playwright MCP の作業ディレクトリ）
- `.DS_Store`

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

## デモ動画 (README.md の `demo.gif`) を撮り直すとき

**ゲームの見た目に変更を入れたら必ず撮り直す。** 触っていい想定の対象は `index.html` / `style.css` / `script.js` のいずれか。盤面・コマ・プレイヤーパネル・アニメーションタイミングなどに手を入れたら、撮り直して `demo.gif` をリプレースする。

### 手順

```sh
# 1. ローカルサーバーを起動
npx --yes serve -p 5173 -L .

# 2. 録画（tests/videos/demo.webm が生成される。約13–15秒）
node tests/record.mjs

# 3. webm → GIF（ffmpeg 必須）
ffmpeg -y -i tests/videos/demo.webm \
  -vf "fps=12,scale=420:-1:flags=lanczos,split[s0][s1];[s0]palettegen=stats_mode=diff[p];[s1][p]paletteuse=dither=bayer:bayer_scale=4" \
  -loop 0 demo.gif

# 4. 差し替えた demo.gif だけコミット（webm は .gitignore で除外済み）
git add demo.gif && git commit -m "Refresh demo.gif"
```

### `tests/record.mjs` の挙動

- iPad Mini (768×1024 / WebKit) で起動
- 「ヒントが出ているマスのうち中央寄り」を 5 手連続で打つ → page back ×2 → page forward ×2、で約 13.5 秒
- ロジックを変えるなら、合計の wall clock が 12〜18 秒に収まるよう `sleep(...)` を調整する。長すぎると GIF が肥大化、短すぎると流れが追えない
- 録画サイズは context option で `768×1024` を明示しているので、いじるときは ffmpeg の `scale=` 値も追従させる

### `demo.gif` のサイズ目標

- 1〜2 MB に収める（README に貼って実用に耐える上限）。`scale=420`、`fps=12`、`bayer_scale=4` が現状のバランス点
- 大きくしたいなら `scale=480` まで。それ以上は GitHub の README 表示で重くなる

## GitHub Pages

- **公開 URL**: https://yusukeiwaki.github.io/reversiweb/
- 設定: `build_type=legacy`, `source.branch=main`, `source.path=/`（branch ベースの静的配信）
- `main` への push が直接反映される。Actions ワークフローも `gh-pages` ブランチも使わない
- 設定確認: `gh api repos/YusukeIwaki/reversiweb/pages`
- 設定変更が必要なときの例:
  ```sh
  gh api -X PUT repos/YusukeIwaki/reversiweb/pages \
    -f 'build_type=legacy' -f 'source[branch]=main' -f 'source[path]=/'
  ```
- `index.html` がリポジトリ root にあるので Pages のトップでそのままゲームが動く。`README.md` は GitHub のリポジトリトップに表示されるだけで Pages 側には出ない（重複しないので OK）
- ビルド状態: `gh api repos/YusukeIwaki/reversiweb/pages/builds/latest`

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
