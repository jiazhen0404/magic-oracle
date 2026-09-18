# 未完籤所 GA4 興趣追蹤

## 五大分類

使用者在「選擇主題」點擊分類時，同時送出：

- `select_theme`：通用事件，參數包含 `theme`、`theme_label`
- `category_interest_love`：愛情
- `category_interest_work`：工作
- `category_interest_choice`：選擇
- `category_interest_life`：生活
- `category_interest_pet`：毛孩心語
- `category_interest_random`：隨機一籤

從 SEO 分類頁直接進入抽籤流程時，則送出 `category_entry_分類代碼`，例如 `category_entry_love`。

## 細情境

使用者點擊失戀中、曖昧中、求職中、離別中等細情境時，同時送出：

- `select_subtheme`：通用事件，參數包含 `theme`、`subtheme`、`situation_key`
- `situation_interest_分類_情境`：可直接從事件名稱辨識，例如：
  - `situation_interest_love_breakup`
  - `situation_interest_work_job_search`
  - `situation_interest_pet_passed_away`

## 抽籤漏斗

- `draw_start`：使用者在「想一件事」頁按下「我準備好了」時送出。
- `draw_complete`：籤文結果頁出現時送出（每週一籤不送）。

兩個事件的參數形狀刻意一致：`theme`、`subtheme`、加上共同管道補的 `fortune_id`。
所以 `draw_complete ÷ draw_start` 就是完成率，可以再按主題或情境切分。

`draw_start` 涵蓋三種進入方式：首頁「今天抽一籤」、SEO 頁的深連結
（`/?theme=love&sub=失戀中#start`）、以及結果頁的「再抽一次」。三種都會經過同一個
函式，所以不會有某個來源算不到的情況。

「再抽一次」會重新送一次 `draw_start`，跟後續的 `draw_complete` 一對一，
完成率不會超過 100%。

注意：`人生` 分類在 `SKIP_SUBTHEME` 裡，兩個事件的 `subtheme` 都會是 `none`。

另有一個舊事件 `start_draw`（只在首頁按鈕送，帶 `entry_point`），
和 `draw_start` 不是同一件事，沒有移除以免既有報表斷掉。

## 延伸解籤預告

一般籤結果頁會顯示「我想看完整延伸解籤」；每週一籤與限時內容不顯示。

使用者點擊後送出：

- `extended_reading_interest`：全部延伸版需求
- `extended_interest_love`
- `extended_interest_work`
- `extended_interest_choice`
- `extended_interest_life`
- `extended_interest_pet`

同一支籤在同一個瀏覽階段只記錄一次，避免連續點擊灌高數據。

## 在 GA4 查看

前往「報表 → 查看使用者參與度和留存率 → 事件」。正式事件報表可能延遲數小時至一天；部署後的立即測試，可先使用 GA4 即時報表查看最近 30 分鐘事件。

