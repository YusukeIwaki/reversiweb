# 開発者向けメモ（Claude 用）

`SPEC.md` がプロダクト要件、こちらは「コードを触るときの注意点・背景」。

## ファイル構成

```
index.html                     ボディ全体を組む。SPA だが 1 画面のみ
style.css                      レイアウト、盤面、コマの見た目、アニメーション
flip-order.js                  フリップ方向グループの並び替えと順次スケジューラ（純粋ロジック、UMD）
script.js                      ゲームロジック・履歴管理・DOM 更新（IIFE で完結）
playwright.config.mjs          @playwright/test の設定（プロジェクト分割・webServer）
package.json                   @playwright/test と playwright（録画用）に依存
tests/ipad.spec.mjs            iPad Mini (WebKit) エミュレーションでの E2E シナリオ
tests/flip-order.spec.mjs      flip-order.js の単体テスト（Chromium + about:blank）
tests/record.mjs               README.md 用 GIF 元動画 (webm) を録画するスクリプト
demo.gif                       README.md に貼ってある動作デモ。**git 管理対象**
```

外部ライブラリ・ビルドツールは持ち込まない（アプリ側。テストランナーとして `@playwright/test` は使う）。`script.js` は IIFE 1 個。

`.gitignore` の対象（コミットしない）:
- `node_modules/`
- `tests/videos/`（録画の生成物。webm はリポジトリに含めない）
- `tests/screenshots/`（旧テスト時代の中間生成物ディレクトリ。現行の Playwright は使わない）
- `test-results/` / `playwright-report/`（@playwright/test の生成物）
- `.playwright-mcp/`（Playwright MCP の作業ディレクトリ）
- `.DS_Store`

## ローカル起動と検証

```sh
# サーバー起動（ポート 5173 固定で運用中。Playwright MCP もこのポートを向く）
npx --yes serve -p 5173 -L .

# テスト（webServer は playwright.config.mjs が自動起動／reuse する）
npm test                       # 全プロジェクト実行（ipad + flip-order）
npm run test:ipad              # iPad Mini (WebKit) の E2E シナリオのみ
npm run test:flip-order        # flip-order.js の単体テストのみ
```

- `tests/ipad.spec.mjs` は **WebKit 限定**（`playwright.config.mjs` で `browserName: 'webkit'` 明示）。iPad Mini プロファイルで開き、初期配置・着手・0.8s ゲート・フリップ・手数減算・ターン交代・page back/forward での undo/redo・無効クリック無視・盤の縦フィットを検証する。**仕様変更時はここも更新する。**
- `tests/flip-order.spec.mjs` は Chromium で `about:blank` を開き `addScriptTag` で `flip-order.js` を注入する純粋ロジックのテスト。ゲーム DOM を触らないので webServer は使わないが、config の `webServer` が起動するのは許容（`reuseExistingServer: true`）。
- Playwright MCP（`mcp__playwright__*` ツール群）が利用可能なら、対話的検証はそちらで行ってよい。MCP は既定で Chromium を使う点に注意（iPad と同じレイアウトかは別途確認）。

## 設計の要点

### 状態

- すべて `script.js` の `state` オブジェクトに集約：`board[8][8]` (0=空 / 1=黒 / 2=白), `turn`, `handBlack`, `handWhite`, `gameOver`。
- 盤面の DOM はビルド時に 64 セルを 1 度生成し、その後は `.cell` 内の `.piece` 要素を生やす／消す／`data-color` を切り替えるだけ。フル再描画は popstate 復元時のみ (`snapRender`)。

### 履歴（page back/forward）

- 起動時 `boot()` で `history.replaceState({state: clone(initial)}, '')` を必ず呼ぶ。これをしないと、最初の戻り先が state なしのエントリになり popstate ハンドラが「無視」してしまうため、初手を戻したときに復元できなくなる。
- 着手完了時に `history.pushState({state: clone(state)}, '')` で 1 エントリ刻む。
- `popstate` ハンドラは `e.state.state` を読んで `snapRender()`。`snapRender()` は body に `.no-anim` を一瞬付けてトランジションを抑制してから付け替える。
- **アニメ中 (`animating===true`) に popstate が来たらその state を `pendingPopstate` に積んで無視** する。そのまま捨てると URL だけロールバックして画面が残りでズレる。`performMove()` の最後、`animating=false` の直後に pending があれば消化する。複数回 goBack/goForward された場合は最後のものだけ勝ち残る（= 最終 URL と画面が一致する）。

### 着手アニメーションのタイミング（仕様 §6）

`performMove()` の流れ：

1. 即座にコマ DOM 追加 + `state.board` と `handX` 更新 + UI 反映。
2. `await sleep(800)` ← 仕様の「0.8 秒待つ」ゲート。
3. 反転対象の line を「縦 / 横 / 斜め」の 3 グループに仕分け、**グループを枚数降順（同数時は 縦>横>斜）で順次実行**。グループ内は `Promise.all` で line を並列起動、line 内は 200ms 間隔。各石は `flipPieceAnimated()` を起点に「フリップアニメ開始」と同時に `state.board[fr][fc]` を更新。
4. グループとグループの間は `FLIP_ANIM_MS (450) + FLIP_GROUP_GAP_MS (300)` = 750ms 空ける（前グループの最後の反転アニメが終わってから 300ms の静止を挟む）。
5. 全グループのキックオフ完了 (= 最後のグループの最後のフリップが「始まった」瞬間) でターン切替・UI 更新・`pushState`。
6. 最後に `await sleep(FLIP_ANIM_MS)` してアニメーション完了を待ち、`animating = false`。

**ポイント**: ターン切替を「最後のフリップ完了後」ではなく「最後のフリップ開始時」にしているのは、UI のアクティブ表示や次手のヒントを早めに出して操作感を良くするため。`animating` フラグだけはアニメーションが終わるまで真にしておき、二重着手を防ぐ。

方向種別の分類 (`dirKind`)、グループの並び替え (`groupAndSortLines`)、グループ単位の順次スケジューラ (`runFlipSchedule`) は `flip-order.js` に切り出してあり、`window.ReversiFlipOrder` / CommonJS `module.exports` の両方から読めるようにしてある。ここに純粋ロジックを寄せてあるので仕様変更時は `tests/flip-order.spec.mjs` を更新しておくこと。`flipsForMove()` は `{dir, line}` オブジェクトの配列を返すので、直接 `.line` の配列としては使えない点に注意（`hasValidMove` / `showHints` は `.length` しか見ていないので従来どおり）。

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
- 盤サイズは `min(92vw, calc(100vh - 284px))` の正方形。`284px` はプレイヤーパネル 2 段（`min-height: 110px` × 2）+ app の padding + gap の見込み値。パネル高さを変えたらここを追従させる。
- **パネルの横幅は盤面と同じ値**（`width: min(92vw, calc(100vh - 284px))`）に合わせる。これが狂うと「パネル内側 14px = 盤面の木枠 14px」という視覚的な面一 (つらいち) が崩れる。
- パネル内余白は **padding `10px 12px` + border `2px solid transparent` + gap `14px`** で、**アイコン〜パネル外縁 / トレイ〜パネル外縁 / アイコン〜トレイ** がすべて視覚的に 14px（= 盤面の `.board` border の 14px）になるよう計算してある。アクティブ時は border の色が変わるだけなので位置はずれない（border-box で計算しているため）。padding やアイコンサイズを変えるときはこの 14px の等値を必ず保つ。
- `.piece-mini`（プレイヤー識別アイコン）は `70px × 70px`。盤面のコマの実レンダリングサイズ（iPad Mini で約 70.4px）に合わせてある。盤面 piece の `width/height` 比（現状 `84%`）やセルサイズを変えたらアイコンも追従させる。
- 手元のコマは各プレイヤーパネル内の `.tray` (id=`hand-white` / `hand-black`) に **縦長バーを横並び** で入れる。
  - `.hand-piece` は `width: 15px; flex: 0 0 15px; height: 100%` の **固定幅**。減っても太くならず、空きがトレイ末端に出る（= 物理トレイと同じ振る舞い）。`flex: 1 1 0` にしてはいけない。
  - 色は **各バー自体が** `linear-gradient(90deg, 黒, …白)` で左半分黒・右半分白の 1 枚の石を edge-on に立てた見立て。index で色を振り分ける交互配色ではないので、`renderHand()` は DOM 個数を合わせるだけで良い。
  - 高さはトレイ内寸に追従（`min-height: 110px` → tray 内寸 70px）。**盤面 piece 実寸と揃うのは偶然ではなく設計**。パネル min-height を変える場合は盤面 piece 実寸と揃うように再計算すること。
- **点対称レイアウト**：盤中心を回転中心に 180° 回したとき上下パネルが一致する配置。
  - 黒パネル（下）: DOM/視覚とも `[icon][tray]`、`tray` は `flex-direction: row`・駒は `flex-start` で **左詰め**。
  - 白パネル（上）: DOM は `[icon][tray]` のままだが `.player-white` 自体に `flex-direction: row-reverse` を付けて視覚的に `[tray][icon]`。`tray` 側も `.player-white .tray { flex-direction: row-reverse }` で駒は **右詰め**。
  - `renderHand()` の `appendChild` は常に「パイルの内側 = 次に消す石」として機能する。`animateRemoveHandPiece()` が `handEl.lastElementChild` を抜くロジックはこの row-reverse のおかげで白黒両方で正しく動いている。片方だけ変えると破綻するので、両トレイのフリックス方向は必ずセットで見る。
- **BLACK / WHITE / YOUR TURN などのキャプションは持たない**（仕様 §5.1）。手番は `.player.active` の金枠光で表現する。キャプションを足したくなったら仕様側に上げて判断すること。
- `meta viewport` で `maximum-scale=1, user-scalable=no` を指定し、Safari のダブルタップズームを抑止している。

### 手元トレイの描画・アニメーション

- `renderHand(handEl, color, count)` は **DOM 個数合わせのみ**。色は CSS 背景に焼き込んであるので第 2 引数 `color` は使っていない（関数シグネチャだけ残してある）。
- `animateRemoveHandPiece(handEl)` は `lastElementChild` を即 DOM から外し、同位置に `position: fixed` のゴーストを置いて fade + `translateY` で盤方向に飛ばす（白パネルは `+18px`、黒パネルは `-18px`）。ゴーストを使うことで「減算直後の `.hand-piece` 個数」と state 値が常に一致し、テストが `count === N` を即読めるようにしてある。ここを CSS トランジションで「その場でフェードしつつ残す」実装に戻すとテストの手数アサーションが取れなくなるので注意。
- `snapRender()`（popstate 復元時）は `renderHand()` を呼び直すのでゴーストは関与しない。body の `.no-anim` クラスで transition を一瞬殺してから DOM を組み直しているため、戻り/進むで手元がピクッと動くことはない。

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

- 対局中はリセット UI を持たない（仕様）。ただし **ゲーム終了オーバーレイ内のリセットボタンは例外として許可**。オーバーレイの `.overlay-reset` がそれで、クリックで `resetGame()` が走り初期盤面からやり直す（SPEC §2 参照）。この例外を広げない（タイトルバー等に途中リセットを足さない）。
- **リセット時の履歴クリア（issue #2）**: `resetGame()` は `location.reload()` ではなく `history.go(-idx)` → `pushState` で履歴を畳む。各 history エントリに `idx`（ブートから何手目か）を埋めてあり、リセット時は `history.go(-idx)` でブートエントリまで戻ったあと `pushState` することで、直前までプレイしていたゲームの中間エントリを forward 履歴ごとプルーニングする（`pushState` は仕様上 forward 側を消す）。`location.reload()` だとブラウザの戻るボタンで対局中の盤面に戻れてしまう回帰があるので戻さない。ブートエントリは常に `initialState` のままなので、リセット後に戻るを押しても同じフレッシュ盤面が映り、もう一度戻るでサイト外に抜ける。
- `script.js` の `FLIP_DELAY_START_MS = 800`、`FLIP_INTERVAL_MS = 200`、`FLIP_ANIM_MS = 450`、`FLIP_GROUP_GAP_MS = 300` は仕様値。変える場合は `tests/ipad.spec.mjs` の `waitForTimeout`、`tests/flip-order.spec.mjs` の期待値、`@keyframes coin-flip` の duration をセットで見直す。
- `state.handBlack` / `state.handWhite` の初期値は `30`（盤上 4 枚は手元 32 枚から 2 枚ずつ出した残）。見た目を「32 枚揃っている物理トレイ」に寄せたくなっても、**state 値を動かさずに CSS 側で演出する** 方針（ロジック・テスト・SPEC の一貫性を壊さない）。
- `clone(state)` は浅すぎるとバグる（`board` が共有されると履歴が壊れる）。`script.js` の `clone()` は `board.map(row => row.slice())` で行コピーしている。新しい配列フィールドを足すときは `clone()` の更新を忘れないこと。
- 着手中（`animating === true`）はクリックを無視し、`popstate` はハンドラ内で `pendingPopstate` に積んで `animating=false` 時に消化する。「テストで連打→すぐ goBack」のシーケンスで URL と state がズレる事故が過去にあったので、この 2 段構えは削らないこと。
- `tests/ipad.spec.mjs` の手数アサーションは `#hand-black / #hand-white` 配下の `.hand-piece` の **子要素数** で見ている（かつて `textContent === '30'` だったが DOM 化した）。`renderHand` / `animateRemoveHandPiece` の実装を変えるなら、「着手直後に `.hand-piece` の count が減っている」不変条件を保つこと。
- **見た目（盤面・コマ・トレイ・パネル・アニメ）を触ったら `demo.gif` を撮り直す**（§「デモ動画」参照）。レイアウト系の変更を入れて `demo.gif` を更新し忘れると README がしばらく古いまま残る。

## 既知の非対応 / 意図的に持っていないもの

- マルチプレイヤー（オンライン対戦）
- 棋譜表示・盤面リプレイ（履歴は browser history に依拠）
- AI 対戦
- スコア表示（手元残数で代替）
- 対局中のリセットボタン（仕様により故意に持たない。ゲーム終了オーバーレイ内のリセットは例外として実装済み）
