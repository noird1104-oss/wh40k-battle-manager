/**
 * WH40K Battle Manager — App.jsx
 *
 * Firebase構成:
 *   battleRooms/{roomId}  … バトル状態（players, turn, activePlayer）
 *   roster/{unitId}       … ユニットロスター（全ユーザー共有の永続保存）
 *
 * firebase.js に以下をエクスポートしてください:
 *   export { db } from "./firebase";
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { auth, db } from "./firebase";
import {
  GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged,
} from "firebase/auth";
import {
  doc, collection, setDoc, getDoc, onSnapshot,
  addDoc, updateDoc, deleteDoc, query, orderBy
} from "firebase/firestore";

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────
const PLAYER_COLORS = ["#C0392B", "#1A6B8A"];
const TOTAL_TURNS   = 5;

const FACTIONS = [
  "アエルダリ","アストラ・ミリタルム","アデプタ・ソロリタス","アデプトゥス・カストーデス",
  "アデプトゥス・タイタニカス","アデプトゥス・メカニカス","インペリアル・ナイト",
  "エンペラーズ・チルドレン","エージェント・オブ・インペリウム","オルク","グレイナイト",
  "ケイオスナイト","サウザンド・サン","ジーンスティーラー・カルト","スペースウルフ",
  "タウ・エンパイア","ダークエンジェル","ティラニッド","デスウォッチ","デスガード",
  "デュカーリ","ネクロン","ブラックテンプラー","ブラッドエンジェル","リーグ・オヴ・ヴォータン",
  "レギオネス・ディーモニカ","ワールドイーター","大逆巨兵団","戦闘者","異端戦闘者",
];
const STAT_KEYS   = ["移","耐","防","傷","統","確"];
const STAT_LABELS = {"移":"移動力","耐":"耐久力","防":"アーマーセーヴ","傷":"負傷限界","統":"指揮統制","確":"確保力"};
const WPN_FIELDS  = [
  {key:"range",label:"射程"},{key:"A",label:"回"},{key:"skill",label:"接"},
  {key:"BS",label:"射"},{key:"S",label:"攻"},{key:"AP",label:"貫"},{key:"D",label:"ダ"},
];
const PHASE_COLORS = {
  turnStart:"#6A5ACD", command:"#D4AF37", movement:"#2E8B57",
  shooting:"#C0392B",  charge:"#E67E22",  fight:"#8B1A1A", turnEnd:"#4A4A6A",
};

// ─────────────────────────────────────────────────────────────────────────────
// TOOLTIP DEFINITIONS
// ─────────────────────────────────────────────────────────────────────────────
const TOOLTIPS = {
  halfStrength:{ title:"半壊状態", body:[
    "ユニットの初期兵数が<em>1体</em>である場合、その兵の【負傷限界】の残量が最大値の<em>半分未満</em>であるならば、そのユニットは半壊状態とみなされる。",
    "それ以外のユニットは、ユニット内の兵数がそのユニットの初期兵数の<em>半分未満</em>であるならば、そのユニットは半壊状態とみなされる。",
  ]},
  battleShock:{ title:"戦闘ショックロール", body:[
    "<em>2D6</em>をロールし、ロール結果がそのユニットの【指揮統制値】以上であれば成功。失敗した場合、次の自軍側指揮フェイズ開始時まで、そのユニットは戦闘ショック状態となる。",
    "戦闘ショック状態のユニット内のすべての兵の【確保力】は「<em>-</em>」となる。",
    "戦闘ショック状態のユニットの操作プレイヤーは、そのユニットを策略の対象に選択できない。",
    "戦闘ショック状態のユニットはアクションの開始を行えず、既に開始しているアクションは完了できない。",
  ]},
  stationary:{ title:"静止", body:[
    "ユニットが静止する場合、以降そのフェイズの終了時まで、そのユニット内のいかなる兵も移動を行なえない。",
  ]},
  normalMove:{ title:"通常移動", body:[
    "最大距離：そのユニットの【<em>移動力</em>】の能力値。",
    "条件：戦場におり、<em>非接敵状態</em>の自軍のユニット。",
    "移動後：そのユニットは非接敵状態でなければならない。",
  ]},
  advanceMove:{ title:"全力移動", body:[
    "最大距離：全力移動ロール（<em>D6</em>）結果と、そのユニットの【<em>移動力</em>】の能力値の合計値。",
    "条件：戦場におり、<em>非接敵状態</em>の自軍のユニット。",
    "移動後：そのユニットは非接敵状態でなければならない。",
    "▪ そのターン終了時まで、他に記述が無い限り、その自軍のユニットは突撃を宣言したり、アクションを開始できない。",
  ]},
  fallBack:{ title:"退却移動", body:[
    "最大距離：そのユニットの【<em>移動力</em>】の能力値。条件：<em>接敵状態</em>の自軍のユニット。",
    "▪ 戦術的後退：戦闘ショック状態でない場合に選択可能。",
    "▪ 決死の脱出：それ以外の場合は必須。各兵に<em>D6</em>をロール。結果が<em>1 or 2</em>なら兵1体が<em>1pt（モンスター/ビークルは3pt）</em>の致命的ダメージ。",
    "移動後：非接敵状態。そのターン終了時まで射撃・突撃・アクション開始不可。",
  ]},
  embark:{ title:"降車移動", body:[
    "配置距離：高速 / 戦術的降車 <em>3mv</em> ／ 戦闘降車 <em>6mv</em>。",
    "▪ 高速降車：通常移動や突入移動済みの場合。降車後、突撃不可。",
    "▪ 戦術的降車：静止中や未移動の場合。降車後、通常移動か全力移動を実行できる。",
    "▪ 戦闘降車：その他の場合。各兵に<em>D6</em>をロール。結果が<em>1 or 2</em>なら兵1体が<em>1pt（モンスター/ビークルは3pt）</em>の致命的ダメージ。降車後、戦闘ショック状態かつ突撃不可。",
  ]},
  deepStrike:{ title:"突入移動", body:[
    "配置距離：<em>6mv</em>。条件：戦略的予備戦力内にいる自軍のユニット。",
    "移動中：戦場端の少なくとも一辺から配置距離内に全体が入り、敵ユニットから水平方向に<em>8mv</em>より遠く離れるよう配置。",
    "▪ 第<em>3</em>バトルラウンド以前：敵軍初期配置ゾーン内に配置不可。",
    "移動後：次の自軍突撃フェイズ開始時まで、他タイプの移動を宣言できない。",
  ]},
  engaged:{ title:"非接敵状態", body:[
    "兵の接敵範囲：水平方向<em>2mv</em>かつ垂直方向<em>5mv</em>の戦場エリア。",
    "▪ 味方の兵が<em>1体以上</em>の敵兵の接敵範囲内にいる間、それらの兵とユニットは互いに接敵状態になる。",
    "▪ ユニット内に接敵状態である兵が<em>1体もいない</em>間、そのユニットは非接敵状態になる。",
  ]},
  NormalShooting:{ title:"通常射撃", body:[
    "条件：非接敵状態であり、このターン中に全力移動を行っていない自軍のユニット。",
    "射撃後：そのフェイズ終了時まで、その自軍のユニットはアクションの開始を宣言できない。",
  ]},
  AssaultShooting:{ title:"アサルト射撃", body:[
    "条件：非接敵状態であり、このターン中に全力移動を行っており、【<em>アサルト</em>】武器を持つ自軍ユニット。",
    "射撃後：そのフェイズ終了時まで、その自軍のユニットはアクションの開始を宣言できない。",
  ]},
  CloseQuartersShooting:{ title:"至近射撃", body:[
    "条件：接敵状態であり、このターン中に全力移動を行っておらず、【<em>至近</em>】武器を持つかモンスター/ビークルである自軍ユニット。",
    "▪ 通常ユニットは【<em>至近</em>】武器のみ使用可能で、接敵中の敵のみを攻撃可能。",
    "▪ モンスター/ビークルは射撃可能だが、接敵中の敵への【<em>至近</em>】武器以外の攻撃はヒットロールに<em>-1</em>の修正。",
    "射撃後：そのフェイズ終了時まで、その自軍のユニットはアクションの開始を宣言できない。",
  ]},
  IndirectShooting:{ title:"間接射撃", body:[
    "条件：非接敵状態で、このターン中に全力移動を行っておらず、【<em>間接</em>】武器を持つ自軍ユニット。",
    "▪ 視認できない敵ユニットを攻撃可能。▪ 攻撃対象は遮蔽物ボーナスを得る。▪ ヒットロールのリロール不可。",
    "▪ 修正前出目<em>1-5</em>は失敗。ただし静止状態、または味方が攻撃対象を視認している場合は<em>1-3</em>のみ失敗。",
  ]},
  NormalFight:{ title:"通常白兵", body:[
    "条件：接敵状態の自軍ユニット。",
    "白兵中：その武器を持つ兵と接敵状態の敵ユニットを、武器の【<em>回数</em>】の能力値まで対象に選択できる。",
  ]},
  OverrunFight:{ title:"制圧白兵", body:[
    "条件：非接敵状態である、またはこの白兵フェイズ中に非接敵状態から接敵状態になった自軍ユニット。",
    "▪ その自軍のユニットは追加で<em>1回</em>の接敵移動を行える。",
  ]},
  OngoingConsolidation:{ title:"戦闘再編移動", body:[
    "条件：接敵状態であり、このフェイズ中に白兵を宣言可能であった自軍ユニット。",
    "▪ 敵兵とベース接触している兵は移動できない。▪ 接敵中の敵ユニットへ近づくように移動する。",
    "移動後：移動開始時に接敵していた敵ユニットとの接敵状態を維持しなければならない。",
  ]},
  EngagingConsolidation:{ title:"接敵再編移動", body:[
    "条件：非接敵状態であり、このフェイズ中に白兵を宣言可能であった自軍ユニットかつ、<em>3mv</em>以内に敵ユニットが存在する。",
    "移動中：選択した敵ユニットへ近づくように移動する。選択したすべての敵ユニットと接敵状態でなければならない。",
  ]},
  ObjectiveConsolidation:{ title:"目標再編移動", body:[
    "条件：接敵状態ではなく、このフェイズ中に白兵を宣言可能であった自軍ユニットかつ、<em>3mv</em>以内に作戦目標が存在する。",
    "移動後：選択した作戦目標の確保範囲内にいなければならない。",
  ]},
};

// ─────────────────────────────────────────────────────────────────────────────
// PHASE DATA
// ─────────────────────────────────────────────────────────────────────────────
const PHASES = [
  { id:"turnStart", name:"ターン開始時", steps:[
    { id:"ts1", name:"ターン開始時ステップ", bullets:[
      { text:"ターン開始時に誘発するルールを解決する。" },
    ]},
  ]},
  { id:"command", name:"指揮フェイズ", steps:[
    { id:"cmd1", name:"１. 指揮フェイズ開始時", bullets:[
      { text:"指揮フェイズ開始時に誘発するルールを解決する。" },
    ]},
    { id:"cmd2", name:"２. 指揮ポイント（CP）の獲得", cpGrant:true, bullets:[
      { text:"互いのプレイヤーが指揮ポイント（CP）を<em>1ポイント</em>獲得する。" },
    ]},
    { id:"cmd3", name:"３. 戦闘ショックステップ", tooltips:["battleShock","halfStrength"], bullets:[
      { text:"アクティブプレイヤーは、以下の条件を<em>1つ以上</em>満たしている自軍の各ユニットに、<strong class='tl' data-tip='battleShock'>戦闘ショックロール</strong>を<em>1回</em>ずつ行う。" },
      { text:"▪ そのユニットが現在<em>戦闘ショック状態</em>である。" },
      { text:"▪ そのユニットが<strong class='tl' data-tip='halfStrength'>半壊状態</strong>である。" },
      { text:"このステップの開始時にユニットが戦闘ショック状態であり、<strong class='tl' data-tip='battleShock'>戦闘ショックロール</strong>に成功した場合、そのユニットは戦闘ショック状態ではなくなる。" },
    ]},
    { id:"cmd4", name:"４. 指揮アビリティ", tooltips:["battleShock"], bullets:[
      { text:"指揮フェイズに誘発するルール（このフェイズの開始時や終了時、CP獲得時、または<strong class='tl' data-tip='battleShock'>戦闘ショックロール</strong>時に誘発するルールを除く）を解決する。" },
    ]},
    { id:"cmd5", name:"５. 指揮フェイズ終了時", bullets:[
      { text:"以下の順番に従って、指揮フェイズ終了時に誘発するルールを解決する。" },
      { text:"<em>1.</em> 最初に、このタイミングで誘発するルールのうち、<em>ミッションルール以外</em>のルールを解決する。" },
      { text:"<em>2.</em> 次に、いずれかのプレイヤーがミッションに関係する処理がある場合、それらを解決する。" },
    ]},
  ]},
  { id:"movement", name:"移動フェイズ", steps:[
    { id:"mov1", name:"１. 移動フェイズ開始時", bullets:[
      { text:"移動フェイズ開始時に誘発するルールを解決する。" },
    ]},
    { id:"mov2", name:"２. ユニットの移動", tooltips:["stationary","normalMove","advanceMove","fallBack","embark","deepStrike","engaged"], bullets:[
      { text:"アクティブプレイヤーは以下の手順を使用して、自軍のユニットを<em>1個ずつ</em>移動させる。すべての自軍のユニットの移動が完了するまで繰り返す。" },
      { text:"<em>1.</em> ユニットの選択：このフェイズ中にまだ移動を宣言していない味方ユニットを<em>1個</em>選択する。" },
      { text:"<em>2.</em> 移動タイプの選択：　▪ <strong class='tl' data-tip='stationary'>静止</strong>　▪ <strong class='tl' data-tip='normalMove'>通常移動</strong>　▪ <strong class='tl' data-tip='advanceMove'>全力移動</strong>　▪ <strong class='tl' data-tip='fallBack'>退却移動</strong>　▪ <strong class='tl' data-tip='embark'>降車移動</strong>　▪ <strong class='tl' data-tip='deepStrike'>突入移動</strong>" },
    ]},
    { id:"mov3", name:"３. 移動フェイズ終了時", bullets:[
      { text:"移動フェイズ終了時に誘発するルールを解決する。" },
    ]},
  ]},
  { id:"shooting", name:"射撃フェイズ", steps:[
    { id:"sho1", name:"１. 射撃フェイズ開始時", bullets:[{ text:"射撃フェイズ開始時に誘発するルールを解決する。" }]},
    { id:"sho2", name:"２. 射撃", tooltips:["NormalShooting","AssaultShooting","CloseQuartersShooting","IndirectShooting"], bullets:[
      { text:"アクティブプレイヤーは以下の手順を使用して、<em>1ユニット</em>ずつ射撃を行わせる。" },
      { text:"<em>1.</em> ユニットの選択：射撃を宣言可能な味方ユニットを<em>1個</em>選択する。" },
      { text:"<em>2.</em> 射撃タイプ：　▪ <strong class='tl' data-tip='NormalShooting'>通常射撃</strong>　▪ <strong class='tl' data-tip='AssaultShooting'>アサルト射撃</strong>　▪ <strong class='tl' data-tip='CloseQuartersShooting'>至近射撃</strong>　▪ <strong class='tl' data-tip='IndirectShooting'>間接射撃</strong>" },
    ]},
    { id:"sho3", name:"３. 射撃フェイズ終了時", bullets:[{ text:"射撃フェイズ終了時に誘発するルールを解決する。" }]},
  ]},
  { id:"charge", name:"突撃フェイズ", steps:[
    { id:"cha1", name:"１. 突撃フェイズ開始時", bullets:[{ text:"突撃フェイズ開始時に誘発するルールを解決する。" }]},
    { id:"cha2", name:"２. 突撃", bullets:[
      { text:"アクティブプレイヤーは以下の手順を使用して、<em>1ユニット</em>ずつ突撃を行わせる。" },
      { text:"<em>1.</em> ユニットの選択：突撃を宣言可能な味方ユニットを<em>1個</em>選択する。" },
      { text:"※<em>12mv</em>以内に敵が存在しない、接敵状態、またはこのターン中に全力移動・退却移動を行ったユニットは選択不可。" },
      { text:"<em>2.</em> 突撃ロール：<em>2D6</em>をロールし、突撃移動の最大距離を決定する。" },
      { text:"<em>3.</em> 突撃移動：突撃移動が可能であれば実行する。" },
    ]},
    { id:"cha3", name:"３. 突撃フェイズ終了時", bullets:[{ text:"突撃フェイズ終了時に誘発するルールを解決する。" }]},
  ]},
  { id:"fight", name:"白兵戦フェイズ", steps:[
    { id:"fig1", name:"１. 白兵フェイズ開始時", bullets:[{ text:"白兵フェイズ開始時に誘発するルールを解決する。" }]},
    { id:"fig2", name:"２. 接敵移動", bullets:[
      { text:"白兵フェイズ中、接敵移動可能なユニットは最大<em>3mv</em>の接敵移動を行える。" },
      { text:"<em>1.</em> ユニットの選択：接敵状態、このターン中に突撃移動を行った、またはこのフェイズ中に制圧白兵を選択した自軍ユニットを選択する。" },
      { text:"<em>2.</em> 接敵移動対象：接敵状態なら接敵中の敵ユニットすべて。非接敵状態なら<em>5mv</em>以内の敵ユニット<em>1個</em>以上。" },
      { text:"<em>3.</em> 接敵移動：最も近い対象へ近づくように移動する。※敵兵とベース接触中の兵は移動不可。" },
      { text:"<em>4.</em> 移動終了：ユニットは接敵状態でなければならず、既に接敵していた敵との接敵は維持する。" },
    ]},
    { id:"fig3", name:"３. 白兵", tooltips:["NormalFight","OverrunFight"], bullets:[
      { text:"プレイヤーは交互に、白兵を宣言可能なユニットを<em>1個</em>ずつ選択して白兵を解決する。" },
      { text:"※【<em>先手</em>】を持つユニットを優先して解決する。" },
      { text:"<em>1.</em> ユニットの選択：接敵状態（このステップ開始時に接敵であった場合を含む）またはこのターン中に突撃移動を行ったユニット。" },
      { text:"<em>2.</em> 白兵タイプ：　▪ <strong class='tl' data-tip='NormalFight'>通常白兵</strong>　▪ <strong class='tl' data-tip='OverrunFight'>制圧白兵</strong>" },
    ]},
    { id:"fig4", name:"４. 再編移動", tooltips:["OngoingConsolidation","EngagingConsolidation","ObjectiveConsolidation"], bullets:[
      { text:"アクティブプレイヤーは、白兵フェイズ中に白兵を宣言可能であったユニットに<em>最大3mv</em>の再編移動を行わせる。" },
      { text:"　▪ <strong class='tl' data-tip='OngoingConsolidation'>戦闘再編移動</strong>　▪ <strong class='tl' data-tip='EngagingConsolidation'>接敵再編移動</strong>　▪ <strong class='tl' data-tip='ObjectiveConsolidation'>目標再編移動</strong>" },
    ]},
    { id:"fig5", name:"５. 白兵フェイズ終了時", bullets:[{ text:"白兵フェイズ終了時に誘発するルールを解決する。" }]},
  ]},
  { id:"turnEnd", name:"ターン終了時", steps:[
    { id:"te1", name:"ターン終了時ステップ", bullets:[
      { text:"以下の順番に従って、ターン終了時に誘発するルールを解決する。" },
      { text:"<em>1.</em> 最初に、このタイミングで誘発するルールのうち、<em>ミッションルール以外</em>のルールを解決する。" },
      { text:"<em>2.</em> 次に、いずれかのプレイヤーがミッションに関係する処理がある場合、それらを解決する。" },
    ]},
  ]},
];

// ─────────────────────────────────────────────────────────────────────────────
// STRATAGEMS
// ─────────────────────────────────────────────────────────────────────────────
const STRATAGEMS = [
  { id:"s1", name:"リロール命令", cp:"1CP", body:[
    "<em>タイミング</em>：どのフェイズでも。味方ユニットや兵が、以下のロールのいずれか<em>1つ</em>を行った直後：",
    "　▪ 全力移動ロール　▪ 突撃ロール　▪ ダメージ量判定ロール　▪ 危機ロール",
    "　▪ ヒットロール　▪ セーブロール　▪ ウーンズロール　▪ 攻撃回数を決めるためのロール",
    "<em>対象</em>：そのユニットまたは兵。",
    "<em>効果</em>：そのロールをリロールする。<em>2個以上</em>のダイスを同時にロールしている場合、<em>1個</em>を選んでリロールする（突撃ロールの場合は<em>すべて</em>をリロールすること）。",
  ]},
  { id:"s2", name:"英雄的挑戦", cp:"1CP", body:[
    "<em>タイミング</em>：白兵フェイズ中、味方キャラクター・ユニットが白兵を宣言した直後。",
    "<em>対象</em>：そのキャラクター・ユニット。",
    "<em>効果</em>：そのユニット内のキャラクターの兵<em>1体</em>を選択する。そのフェイズの終了時まで、その兵が装備している白兵武器は［<em>精密攻撃</em>］アビリティを持つ。",
  ]},
  { id:"s3", name:"狂気の奮戦", cp:"1CP", body:[
    "<em>タイミング</em>：自軍の指揮フェイズの戦闘ショックステップ中、味方ユニットが戦闘ショックロールを行う直前。",
    "<em>対象</em>：そのユニット。",
    "<em>効果</em>：その戦闘ショックロールは<em>自動的に成功</em>する。",
    "<em>制限</em>：自軍はこの策略をバトル中<em>1回限り</em>使用できる。",
  ]},
  { id:"s4", name:"爆発物使用", cp:"1CP", body:[
    "<em>タイミング</em>：自軍側射撃フェイズ中。",
    "<em>対象</em>：このターン中に全力移動を行っておらず射撃を宣言可能な、非接敵状態の味方爆発物/グレネード・ユニット<em>1個</em>。",
    "<em>効果</em>：　<em>1.</em> そのユニット内の爆発物/グレネードの兵を<em>1体</em>選択する。",
    "　<em>2.</em> 選択した兵の<em>8mv</em>以内、視認可能で、非接敵状態の敵ユニットを<em>1個</em>選択する。",
    "　<em>3.</em> <em>D6を6個</em>ロールする。<em>4+</em>が出るたび、選択された敵ユニットは<em>1ポイント</em>の致命的ダメージを受ける。",
  ]},
  { id:"s5", name:"激突", cp:"1CP", body:[
    "<em>タイミング</em>：自軍の突撃フェイズ中、味方モンスター/ビークル・ユニットが突撃移動を終了した直後。",
    "<em>効果</em>：　<em>1.</em> そのユニットと接敵状態である敵ユニットを<em>1個</em>選択する。",
    "　<em>2.</em> 選択した敵ユニットと接敵状態である、その味方ユニット内の兵を<em>1体</em>選択する。",
    "　<em>3.</em> その味方の兵の【耐久力】と同じ数の<em>D6</em>をロールする：<em>1</em>の場合は自軍ユニットが<em>1pt</em>、<em>5+</em>の場合は選択した敵ユニットが<em>1pt</em>の致命的ダメージ（最大<em>6pt</em>）。",
  ]},
  { id:"s6", name:"即応投入", cp:"1CP", body:[
    "<em>タイミング</em>：敵軍側移動フェイズ終了時。",
    "<em>対象</em>：戦略的予備兵力に配置されている味方ユニット<em>1個</em>（航空機を除く）。",
    "<em>効果</em>：その自軍のユニットは突入移動を行う。",
    "<em>制限</em>：第<em>1</em>バトルラウンド中は使用できない。",
  ]},
  { id:"s7", name:"警戒射撃", cp:"1CP", body:[
    "<em>効果</em>：その自軍のユニットは即応射撃で射撃を行う。",
    "　▪ <em>24mv</em>以内、視認可能な敵ユニット<em>1個</em>のみを対象に選択できる。",
    "　▪ 常にヒットロールで修正前の出目<em>6</em>が出た場合のみヒットする。▪ ヒットロールをリロールできない。",
    "射撃後：そのフェイズ終了時まで、その自軍のユニットはアクションの開始を宣言できない。",
  ]},
  { id:"s8", name:"煙幕", cp:"1CP", body:[
    "<em>タイミング</em>：敵軍側射撃フェイズ開始時。",
    "<em>対象</em>：味方の煙幕・ユニット<em>1個</em>。",
    "<em>効果</em>：そのフェイズ終了時まで、その自軍の煙幕・ユニットか、その煙幕ユニット内の兵<em>1体以上</em>によって攻撃側の兵が完全視認を妨げられている状態のユニットを対象にした攻撃が行なわれた場合、攻撃対象はその攻撃に対して<em>遮蔽物ボーナス</em>を得る。",
  ]},
  { id:"s9", name:"英雄的介入", cp:"1CP", body:[
    "<em>タイミング</em>：敵軍側突撃フェイズ開始時。",
    "<em>対象</em>：<em>1個以上</em>の敵ユニットの<em>12mv</em>以内に一部でも入っている、味方の非接敵状態のユニット<em>1個</em>。",
    "<em>効果</em>：その自軍のユニットは突撃を解決する。以下のモードから<em>1つ</em>を選択：",
    "　▪ <em>前進防衛</em>：このフェイズ中に突撃移動を行っており、最大距離の範囲内にいる敵ユニットのみを選択できる。",
    "　▪ <em>攻勢突進（+1CP）</em>：突撃ロール結果が<em>6</em>を上回っている場合、ロール結果を<em>6</em>にする。その自軍のユニットの<em>6mv</em>以内にいる敵ユニットを選択できる。",
  ]},
  { id:"s10", name:"反攻戦術", cp:"2CP", body:[
    "<em>タイミング</em>：敵軍側白兵フェイズの白兵ステップ中、いずれかの敵ユニットが攻撃を解決した直後。",
    "<em>対象</em>：白兵を宣言可能な味方ユニット<em>1個</em>。",
    "<em>効果</em>：そのフェイズ終了時まで、その自軍のユニットは【<em>先手</em>】アビリティを持つ。自軍は、次にそのユニットで白兵を宣言しなければならない。",
  ]},
];

// ─────────────────────────────────────────────────────────────────────────────
// CORE ABILITIES
// ─────────────────────────────────────────────────────────────────────────────
const CORE_ABILITIES = [
  { id:"ca1",  name:"［特効］",       body:["このアビリティは常に<em>［X 特効 Y+］</em>という形式で表記される。攻撃対象が X 部分のキーワードを持つならば、ウーンズロールで修正前の出目<em>Y+</em>が出た場合、<em>クリティカルウーンズ</em>となる。"] },
  { id:"ca2",  name:"［アサルト］",   body:["［アサルト］武器を持つ兵が<em>1個でも</em>含まれているユニットは、アサルト射撃を使用して射撃できる。"] },
  { id:"ca3",  name:"［ブラスト］",   body:["攻撃対象選択ステップにおいて選択されたユニット内の兵<em>5体ごと</em>（端数切り下げ）に、追加で<em>1個</em>の攻撃ダイスを得る。","<em>［ブラストX］</em>の場合は兵<em>5体ごと</em>に追加で<em>X個</em>の攻撃ダイスを得る。"] },
  { id:"ca4",  name:"［蹂躙］",       body:["常に<em>［蹂躙 X］</em>という形式で表記される。その武器のすべての攻撃で単一の対象を選択していたならば、選択されたユニット内の兵<em>5体ごと</em>（端数切り下げ）に、追加で<em>X個</em>の攻撃ダイスを得る。"] },
  { id:"ca5",  name:"［至近］",       body:["［至近］武器を持つ兵が<em>1個でも</em>含まれているユニットは、至近射撃を使用して射撃できる。","それ以外の射撃タイプを使用している時、そのユニット内の各兵は以下のうち<em>1つ</em>だけを選択して攻撃できる：その兵が持つ<em>1個以上</em>の［至近］武器、またはその兵が持つ<em>1個以上</em>の他の射撃武器。"] },
  { id:"ca6",  name:"恐るべき最期",   body:["常に<em>恐るべき最期 X</em>という形式で表記される。このユニット内の兵が撃破されるたび、緊急降車移動をした後で<em>D6</em>を1個ロールする。ロール結果が<em>6</em>であれば、その兵の<em>6mv</em>以内に一部でも入っているユニットは<em>Xポイント</em>の致命的ダメージを受ける。"] },
  { id:"ca7",  name:"縦深攻撃",       body:["このユニットが突入移動をする際、ユニット内の全兵がこのアビリティを持っているならば、このユニットをあらゆる敵ユニットから水平方向に<em>8mv</em>より遠く離れるように、戦場の<em>任意の地点</em>に配置してもよい（敵軍初期配置ゾーン内も可能）。"] },
  { id:"ca8",  name:"［会心ウーンズ］", body:["クリティカルウーンズが発生したならば、その攻撃手順はそこで終了し、攻撃対象ユニットはその武器の【ダメージ量】に等しいポイント数の<em>致命的ダメージ</em>を受ける。","致命的ダメージを与えることができるのは、<em>1回のクリティカルウーンズごとに最大で兵1体</em>に対してのみ。残りの致命的ダメージは失われる。"] },
  { id:"ca9",  name:"［追加攻撃］",   body:["［追加攻撃］武器を持つ兵が<em>1体でも</em>含まれているユニットが白兵戦をする際、それらの兵はその他の武器に加えて該当の武器による攻撃もする。"] },
  { id:"ca10", name:"痛みを知らぬ者", body:["常に<em>痛みを知らぬ者 X+</em>という形式で表記される。このアビリティを持つ兵が【負傷限界】を<em>1ポイント</em>失うことになるたび、<em>D6</em>を1個ロールする。ロール結果が<em>X+</em>であれば、その【負傷限界】は失われない。"] },
  { id:"ca11", name:"先手",           body:["ユニット内のあらゆる兵がこのアビリティを持つならば、そのユニットは<em>先手ユニット</em>である。白兵戦フェイズにおける先手解決ステップを参照せよ。"] },
  { id:"ca12", name:"射撃デッキ",     body:["常に<em>射撃デッキ X</em>という形式で表記される。自軍射撃フェイズ中、この兵員輸送が射撃のために選択されるたび、乗車ユニットが<em>1個でも</em>いるならば乗車中の兵を最大<em>X体</em>まで選択し、選択した各兵の射撃武器（一発限り武器を除く）を<em>1個</em>選択する。ターン終了時まで、乗車しているユニットは射撃を宣言できない。"] },
  { id:"ca13", name:"［暴発］",       body:["ユニットが射撃や白兵戦のために選択された際、あらゆる攻撃を解決するよりも前に、武器選択ステップで選択した［暴発］武器の数に等しい<em>危機ロール</em>をする。"] },
  { id:"ca14", name:"［ヘヴィ］",     body:["自軍射撃フェイズ中、攻撃側ユニットが非接敵状態・そのターン中に戦場に配置されていない・どの兵もそのターン中に<em>3mv</em>より多く移動していない場合、ヒットロールは<em>+1</em>の修正を受ける。"] },
  { id:"ca15", name:"ホバー",         body:["このユニットが宙に舞い上がる際、最大距離から<em>2mv</em>を差し引かない。"] },
  { id:"ca16", name:"［遮蔽無効］",   body:["攻撃する際、攻撃対象はその攻撃に対して<em>遮蔽物ボーナスを受けることができない</em>。隠密能力なども無効化する。"] },
  { id:"ca17", name:"［間接射撃］",   body:["［間接射撃］武器を持つ兵が<em>1個でも</em>含まれているユニットは、<em>間接射撃</em>を使用して射撃できる。"] },
  { id:"ca18", name:"浸透戦術",       body:["初期配置中、ユニット内のすべての兵がこのアビリティを有している場合、そのユニットを敵軍側初期配置ゾーンおよびあらゆる敵兵から水平方向に<em>8mv</em>より遠く離れた任意の地点に配置できる。"] },
  { id:"ca19", name:"［ランス］",     body:["攻撃側兵がそのターン中に突撃移動をしていたならば、ウーンズロールは<em>+1</em>の修正を受ける。"] },
  { id:"ca20", name:"［会心ヒット］", body:["クリティカルヒットが発生した場合、その攻撃が対象に<em>自動的にダメージを与える</em>ことを選択してもよい。"] },
  { id:"ca21", name:"単独工作員",     body:["合流ユニットの一部でなく、敵兵から<em>12mv</em>以内に一部でも入っているのでない限り、このユニットは<em>視認されない</em>。また、攻撃側兵がこのユニットの<em>12mv</em>以内に一部でも入っているのでない限り、［間接射撃］の対象にもならない。"] },
  { id:"ca22", name:"［メルタ］",     body:["常に<em>［メルタ X］</em>という形式で表記される。攻撃対象をその武器の【射程】の<em>半分以内</em>に選択したならば、その武器の【ダメージ量】は<em>+X</em>の修正を受ける。"] },
  { id:"ca23", name:"［一発限り］",   body:["このアビリティを持つ武器は、バトル中<em>1回限り</em>攻撃のために選択できる。撃破された兵がユニットに復帰したとしても、そのバトル中すでに攻撃のために選択された武器は、それ以上選択できない。"] },
  { id:"ca24", name:"［ピストル］",   body:["［ピストル］と［至近］は、ルール上<em>同一</em>のものである。［至近］を参照せよ。"] },
  { id:"ca25", name:"［精密攻撃］",   body:["攻撃対象のユニットに攻撃側兵から視認できるキャラクター兵が<em>1体でも</em>含まれているならば、アクティブプレイヤーはそのキャラクターが含まれている割り当てグループを<em>1つ</em>選択してもよい。"] },
  { id:"ca26", name:"［サイキック］", body:["攻撃する際、自軍はその攻撃の【射撃技能】や【近接技能】に対する修正、そしてヒットロールに対する修正を、<em>任意に無視</em>してもよい。サイキック攻撃と呼称される。"] },
  { id:"ca27", name:"［ラピッドファイア］", body:["常に<em>［ラピッドファイア X］</em>という形式で表記される。攻撃対象のユニットが、その武器の【射程】の<em>半分以内</em>にいたならば、追加で<em>X個</em>の攻撃ダイスを得る。"] },
  { id:"ca28", name:"斥候",           body:["常に<em>斥候 Xmv</em>という形式で表記される。バトル開始前アビリティの解決ステップにおいて、ユニット内の全兵がこのアビリティを持つならば、自軍初期配置ゾーン内のユニットは斥候移動（最大<em>Xmv</em>）できる。斥候移動後：あらゆる敵ユニットから水平方向に<em>8mv</em>より遠く離れていなければならない。"] },
  { id:"ca29", name:"隠密能力",       body:["ユニット内の全兵がこのアビリティを持つなら、そのユニットに対する射撃攻撃において、そのユニットは<em>遮蔽物ボーナス</em>を得る。"] },
  { id:"ca30", name:"超重歩行兵器",   body:["通常移動、全力移動、退却を実行する際：兵は兵を通り抜けて移動でき、高さ<em>4mv</em>以下の特殊地形の部位を水平方向に通り抜けることができる。","全兵に<em>高機動</em>キーワードを与えることを選択してもよい。そうする場合、移動終了後に<em>D6</em>を1個ロールする。ロール結果が<em>1</em>であれば、そのユニットは<em>戦闘ショック状態</em>になる。"] },
  { id:"ca31", name:"［連続命中］",   body:["常に<em>［連続命中 X］</em>という形式で表記される。クリティカルヒットが発生したら、その攻撃は追加で<em>X回</em>ヒットする。"] },
  { id:"ca32", name:"［噴射］",       body:["攻撃は、対象に<em>自動的にヒット</em>する。"] },
  { id:"ca33", name:"［ツインリンク］", body:["攻撃は、ウーンズロールを<em>何個でもリロール</em>できる。"] },
];

// ─────────────────────────────────────────────────────────────────────────────
// STYLES
// ─────────────────────────────────────────────────────────────────────────────
const S = {
  app: { minHeight:"100vh", background:"#0A0A0C", backgroundImage:"radial-gradient(ellipse at 20% 50%,rgba(192,57,43,.04) 0%,transparent 60%),radial-gradient(ellipse at 80% 50%,rgba(26,107,138,.04) 0%,transparent 60%)", fontFamily:"'Courier New','Courier',monospace", color:"#E8E8E8", padding:0 },
  header: { background:"linear-gradient(180deg,#1A1A1F 0%,#0A0A0C 100%)", borderBottom:"2px solid #D4AF37", padding:"10px 14px", display:"flex", alignItems:"center", justifyContent:"space-between", position:"sticky", top:0, zIndex:100 },
  headerTitle: { fontSize:13, fontWeight:"bold", color:"#D4AF37", letterSpacing:2, textTransform:"uppercase", textShadow:"0 0 20px rgba(212,175,55,.4)" },
  headerSub: { fontSize:9, color:"#8B8B8B", letterSpacing:3, textTransform:"uppercase" },
  main: { padding:10, display:"flex", flexDirection:"column", gap:10, maxWidth:900, margin:"0 auto" },
  card: { background:"#1A1A1F", border:"1px solid #2A2A32", borderRadius:6, padding:12 },
  label: { fontSize:9, color:"#8B8B8B", letterSpacing:3, textTransform:"uppercase" },
  gold: { color:"#D4AF37", letterSpacing:3, textTransform:"uppercase", fontSize:11 },
  input: { background:"#0A0A0C", border:"1px solid #2A2A32", borderRadius:3, color:"#E8E8E8", padding:"4px 8px", fontSize:12, fontFamily:"inherit", outline:"none", width:"100%", boxSizing:"border-box" },
  select: { background:"#0A0A0C", border:"1px solid #2A2A32", borderRadius:3, color:"#E8E8E8", padding:"4px 8px", fontSize:12, fontFamily:"inherit", outline:"none", width:"100%", boxSizing:"border-box" },
  iconBtn: (c="#8B8B8B")=>({ width:22, height:22, background:"#1A1A1F", border:"1px solid #2A2A32", borderRadius:3, color:c, fontSize:12, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", fontFamily:"inherit", lineHeight:1, flexShrink:0 }),
  outlineBtn: (c="#D4AF37")=>({ padding:"5px 10px", background:"transparent", border:`1px solid ${c}`, borderRadius:3, color:c, fontSize:11, cursor:"pointer", fontFamily:"inherit", letterSpacing:1, whiteSpace:"nowrap" }),
  solidBtn: (c="#D4AF37")=>({ padding:"7px 14px", background:c, border:"none", borderRadius:3, color:"#0A0A0C", fontSize:12, fontWeight:"bold", cursor:"pointer", fontFamily:"inherit", letterSpacing:2, textTransform:"uppercase", whiteSpace:"nowrap" }),
  dangerBtn: { padding:"7px 14px", background:"#C0392B", border:"none", borderRadius:3, color:"#fff", fontSize:12, fontWeight:"bold", cursor:"pointer", fontFamily:"inherit", letterSpacing:1, whiteSpace:"nowrap" },
  ctrBtn: (c)=>({ width:26, height:26, background:"#0A0A0C", border:`1px solid ${c}66`, borderRadius:3, color:c, fontSize:15, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", fontFamily:"inherit", lineHeight:1 }),
  overlay: { position:"fixed", inset:0, background:"rgba(0,0,0,.88)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:200, padding:16 },
  modal: { background:"#1A1A1F", border:"1px solid #D4AF37", borderRadius:8, padding:20, width:"100%", maxWidth:560, maxHeight:"90vh", overflowY:"auto", boxShadow:"0 0 40px rgba(212,175,55,.15)", boxSizing:"border-box" },
  statGrid: { display:"grid", gridTemplateColumns:"repeat(6,1fr)", gap:4, marginTop:6 },
  statCell: { background:"#0A0A0C", border:"1px solid #2A2A32", borderRadius:3, padding:"4px 2px", textAlign:"center" },
  statCellLabel: { fontSize:9, color:"#8B8B8B", letterSpacing:1 },
  statCellVal: { fontSize:13, fontWeight:"bold", color:"#D4AF37", lineHeight:1 },
  woundColor: (pct)=> pct>0.6?"#4CAF50":pct>0.3?"#FF9800":"#C0392B",
};

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────
let _id=1;
const uid          = ()=>String(_id++);
const blankStats   = ()=>Object.fromEntries(STAT_KEYS.map(k=>[k,""]));
const blankWeapon  = ()=>({ id:uid(), name:"", type:"射撃", range:"", A:"", skill:"", BS:"", S:"", AP:"", D:"", abilities:"" });
const genRoomId    = ()=>Math.random().toString(36).substring(2,8).toUpperCase();

// Firebase Firestore paths
const roomRef        = (id)=>doc(db,"battleRooms",id);
const rosterCol      = ()=>collection(db,"roster");
const rosterRef      = (id)=>doc(db,"roster",id);
const missionsCol    = ()=>collection(db,"primaryMissions");
const currentMission = (roomId)=>doc(db,"battleRooms",roomId,"meta","mission");

// Default battle state written to Firestore
const defaultBattleState = (names=["プレイヤー1","プレイヤー2"])=>({
  players:[
    { name:names[0], cp:0, vp:0, units:[] },
    { name:names[1], cp:0, vp:0, units:[] },
  ],
  currentTurn:1,
  activePlayer:0,
  gameOver:false,
  gameOverReason:"",
  createdAt:new Date().toISOString(),
});

// ─────────────────────────────────────────────────────────────────────────────
// RICH TEXT
// ─────────────────────────────────────────────────────────────────────────────
function RichText({ html, onTooltip }) {
  const ref=useRef(null);
  useEffect(()=>{
    if(!ref.current) return;
    ref.current.querySelectorAll(".tl").forEach(el=>{
      el.style.cssText="color:#D4AF37;cursor:pointer;border-bottom:1px dashed #D4AF3788;font-weight:bold;";
      el.onclick=(e)=>{ e.stopPropagation(); onTooltip&&onTooltip(el.dataset.tip); };
    });
  });
  return <span ref={ref} dangerouslySetInnerHTML={{ __html:html }} />;
}

// ─────────────────────────────────────────────────────────────────────────────
// TOOLTIP POPUP
// ─────────────────────────────────────────────────────────────────────────────
function TooltipPopup({ tipKey, onClose }) {
  const tip=TOOLTIPS[tipKey];
  if(!tip) return null;
  return (
    <div style={S.overlay} onClick={onClose}>
      <div style={{ ...S.modal, maxWidth:500 }} onClick={e=>e.stopPropagation()}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:12 }}>
          <div style={{ fontSize:14, fontWeight:"bold", color:"#D4AF37", letterSpacing:2 }}>※ {tip.title}</div>
          <button style={S.iconBtn()} onClick={onClose}>✕</button>
        </div>
        <div style={{ display:"flex", flexDirection:"column", gap:8, textAlign:"left" }}>
          {tip.body.map((b,i)=>(
            <div key={i} style={{ fontSize:12, color:"#C8C8C8", lineHeight:1.7, borderLeft:"2px solid #D4AF3744", paddingLeft:10, textAlign:"left" }} dangerouslySetInnerHTML={{ __html:b }} />
          ))}
        </div>
        <div style={{ marginTop:14, textAlign:"right" }}>
          <button style={S.solidBtn("#D4AF37")} onClick={onClose}>閉じる</button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// COLLAPSIBLE
// ─────────────────────────────────────────────────────────────────────────────
function Collapsible({ label, color="#D4AF37", defaultOpen=false, badge=null, fontSize=12, children }) {
  const [open,setOpen]=useState(defaultOpen);
  return (
    <div>
      <button onClick={()=>setOpen(o=>!o)}
        style={{ width:"100%", display:"flex", justifyContent:"space-between", alignItems:"center", background:"transparent", border:"none", cursor:"pointer", padding:"6px 0", fontFamily:"inherit" }}>
        <span style={{ fontSize, fontWeight:"bold", color, letterSpacing:2, textTransform:"uppercase" }}>
          {label}{badge&&<span style={{ marginLeft:8, fontSize:9, color:"#8B8B8B", fontWeight:"normal", textTransform:"none", letterSpacing:0 }}>{badge}</span>}
        </span>
        <span style={{ fontSize:13, color, transform:open?"rotate(180deg)":"rotate(0deg)", transition:"transform .2s", lineHeight:1 }}>∧</span>
      </button>
      {open && <div style={{ marginTop:4 }}>{children}</div>}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// COUNTER
// ─────────────────────────────────────────────────────────────────────────────
function Counter({ value, onChange, color, min=0, max=999 }) {
  return (
    <div style={{ display:"flex", alignItems:"center", gap:5, justifyContent:"center" }}>
      <button style={S.ctrBtn(color)} onClick={()=>onChange(Math.max(min,value-1))}>−</button>
      <span style={{ fontSize:20, fontWeight:"bold", color, minWidth:30, textAlign:"center", fontVariantNumeric:"tabular-nums" }}>{value}</span>
      <button style={S.ctrBtn(color)} onClick={()=>onChange(Math.min(max,value+1))}>+</button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// PHASE PANEL
// ─────────────────────────────────────────────────────────────────────────────
function PhasePanel() {
  const [panelOpen, setPanelOpen]   = useState(false);
  const [phaseIdx, setPhaseIdx]     = useState(0);
  const [stepIdx, setStepIdx]       = useState(0);
  const [openPhases, setOpenPhases] = useState({ 0:true });
  const [tooltip, setTooltip]       = useState(null);

  const phase   = PHASES[phaseIdx];
  const phColor = PHASE_COLORS[phase.id] || "#D4AF37";
  const step    = phase.steps[stepIdx] || null;

  const togglePhaseOpen = (pi) => setOpenPhases(o=>({ ...o, [pi]:!o[pi] }));

  const activateStep = (pi, si) => {
    setPhaseIdx(pi); setStepIdx(si);
    setOpenPhases(o=>({ ...o, [pi]:true }));
  };

  const activatePhase = (pi) => {
    setPhaseIdx(pi); setStepIdx(0);
    setOpenPhases(o=>({ ...o, [pi]:true }));
  };

  const goNext = () => {
    if(stepIdx < phase.steps.length-1) {
      setStepIdx(si => si+1);
    } else if(phaseIdx < PHASES.length-1) {
      activatePhase(phaseIdx+1);
    }
  };

  const isLast = phaseIdx===PHASES.length-1 && stepIdx===phase.steps.length-1;

  return (
    <>
      <div style={S.card}>
        {/* Panel header with top-level collapse toggle */}
        <button onClick={()=>setPanelOpen(o=>!o)}
          style={{ width:"100%", display:"flex", justifyContent:"space-between", alignItems:"center", background:"transparent", border:"none", cursor:"pointer", padding:"2px 0", marginBottom:panelOpen?10:0, fontFamily:"inherit" }}>
          <span style={{ fontSize:12, fontWeight:"bold", color:"#D4AF37", letterSpacing:2, textTransform:"uppercase" }}>フェイズ進行</span>
          <span style={{ fontSize:13, color:"#D4AF37", transform:panelOpen?"rotate(180deg)":"rotate(0deg)", transition:"transform .2s", lineHeight:1 }}>∧</span>
        </button>

        {panelOpen && <>
        {/* Phase tabs */}
        <div style={{ display:"flex", flexDirection:"column", gap:2, marginBottom:10 }}>
          {PHASES.map((ph, pi)=>{
            const pc   = PHASE_COLORS[ph.id]||"#D4AF37";
            const isA  = pi===phaseIdx;
            const isDone = pi<phaseIdx;
            const isOpen = !!openPhases[pi];
            return (
              <div key={ph.id}>
                {/* Phase header row */}
                <div style={{ display:"flex", gap:4, alignItems:"center" }}>
                  <button
                    onClick={()=>activatePhase(pi)}
                    style={{ flex:1, padding:"6px 10px", background:isA?`${pc}22`:"#0A0A0C",
                      border:`1px solid ${isA?pc:isDone?`${pc}44`:"#2A2A32"}`,
                      borderLeft:`3px solid ${isA?pc:isDone?`${pc}66`:"#2A2A32"}`,
                      borderRadius:3, color:isA?pc:isDone?`${pc}99`:"#8B8B8B",
                      fontSize:11, fontWeight:isA?"bold":"normal", cursor:"pointer",
                      fontFamily:"inherit", textAlign:"left", letterSpacing:1 }}>
                    {isDone?"✓ ":""}{ph.name}
                  </button>
                  {ph.steps.length>0 && (
                    <button
                      onClick={()=>togglePhaseOpen(pi)}
                      style={{ ...S.iconBtn(pc), width:24, height:24, fontSize:11,
                        transform:isOpen?"rotate(180deg)":"rotate(0deg)", transition:"transform .2s" }}>
                      ∧
                    </button>
                  )}
                </div>

                {/* Sub-steps — collapsible */}
                {ph.steps.length>0 && isOpen && (
                  <div style={{ marginLeft:12, marginTop:2, display:"flex", flexDirection:"column", gap:2, paddingLeft:8, borderLeft:`2px solid ${pc}33` }}>
                    {ph.steps.map((st,si)=>{
                      const isAs = pi===phaseIdx && si===stepIdx;
                      const isDoneS = pi<phaseIdx || (pi===phaseIdx && si<stepIdx);
                      return (
                        <button key={st.id}
                          onClick={()=>activateStep(pi,si)}
                          style={{ padding:"4px 8px", background:isAs?`${pc}18`:"#0A0A0C",
                            border:`1px solid ${isAs?pc:isDoneS?`${pc}44`:"#2A2A32"}`,
                            borderRadius:3, color:isAs?pc:isDoneS?`${pc}88`:"#6B6B6B",
                            fontSize:10, cursor:"pointer", fontFamily:"inherit",
                            textAlign:"left", fontWeight:isAs?"bold":"normal" }}>
                          {isDoneS?"✓ ":""}{st.name}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Active step content */}
        {step && (
          <div style={{ background:"#0A0A0C", border:`1px solid ${phColor}44`, borderLeft:`3px solid ${phColor}`, borderRadius:4, padding:12, marginBottom:10 }}>
            <div style={{ fontSize:12, fontWeight:"bold", color:phColor, marginBottom:8, letterSpacing:1 }}>
              {step.name}
            </div>
            <div style={{ display:"flex", flexDirection:"column", gap:5, textAlign:"left" }}>
              {step.bullets.map((b,bi)=>(
                <div key={bi} style={{ display:"flex", gap:8, fontSize:12, color:"#C8C8C8", lineHeight:1.65 }}>
                  <span style={{ color:`${phColor}66`, flexShrink:0, marginTop:1 }}>・</span>
                  <RichText html={b.text} onTooltip={setTooltip} />
                </div>
              ))}
            </div>
            {step.tooltips?.length>0 && (
              <div style={{ marginTop:8, display:"flex", gap:5, flexWrap:"wrap" }}>
                {step.tooltips.map(tk=>(
                  <button key={tk} style={{ ...S.outlineBtn(phColor), fontSize:10, padding:"2px 8px" }} onClick={()=>setTooltip(tk)}>
                    ※ {TOOLTIPS[tk]?.title}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        <button style={S.solidBtn(phColor)} onClick={goNext}>
          {isLast ? "─ フェイズ完了 ─" : stepIdx<phase.steps.length-1 ? "次のステップへ →" : "次のフェイズへ →"}
        </button>
        </>}
      </div>

      {tooltip && <TooltipPopup tipKey={tooltip} onClose={()=>setTooltip(null)} />}
    </>
  );
}


// ─────────────────────────────────────────────────────────────────────────────
// STRATAGEMS PANEL
// ─────────────────────────────────────────────────────────────────────────────
function StratagemsPanel() {
  const [openId,setOpenId]=useState(null);
  return (
    <div style={S.card}>
      <Collapsible label="基本策略" color="#D4AF37" fontSize={12}>
        <div style={{ display:"flex", flexDirection:"column", gap:4, marginTop:6 }}>
          {STRATAGEMS.map(s=>(
            <div key={s.id} style={{ background:"#0A0A0C", border:"1px solid #2A2A32", borderRadius:4 }}>
              <button onClick={()=>setOpenId(o=>o===s.id?null:s.id)}
                style={{ width:"100%", display:"flex", justifyContent:"space-between", alignItems:"center", background:"transparent", border:"none", cursor:"pointer", padding:"8px 10px", fontFamily:"inherit" }}>
                <span style={{ fontSize:12, fontWeight:"bold", color:"#E8E8E8", textAlign:"left" }}>{s.name}</span>
                <div style={{ display:"flex", gap:8, alignItems:"center", flexShrink:0 }}>
                  <span style={{ fontSize:11, color:"#D4AF37", background:"#1A1A00", border:"1px solid #D4AF3744", borderRadius:3, padding:"1px 6px" }}>{s.cp}</span>
                  <span style={{ fontSize:12, color:"#D4AF37" }}>{openId===s.id?"∧":"∨"}</span>
                </div>
              </button>
              {openId===s.id&&(
                <div style={{ padding:"0 10px 10px 10px", display:"flex", flexDirection:"column", gap:5, borderTop:"1px solid #2A2A32", textAlign:"left" }}>
                  {s.body.map((b,i)=>(
                    <div key={i} style={{ fontSize:12, color:"#C8C8C8", lineHeight:1.65, marginTop:i===0?8:0, textAlign:"left" }} dangerouslySetInnerHTML={{ __html:b }} />
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </Collapsible>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// CORE ABILITIES PANEL
// ─────────────────────────────────────────────────────────────────────────────
function CoreAbilitiesPanel() {
  const [openId,setOpenId]=useState(null);
  return (
    <div style={S.card}>
      <Collapsible label="コアアビリティ" color="#D4AF37" fontSize={12}>
        <div style={{ display:"flex", flexDirection:"column", gap:4, marginTop:6 }}>
          {CORE_ABILITIES.map(a=>(
            <div key={a.id} style={{ background:"#0A0A0C", border:"1px solid #2A2A32", borderRadius:4 }}>
              <button onClick={()=>setOpenId(o=>o===a.id?null:a.id)}
                style={{ width:"100%", display:"flex", justifyContent:"space-between", alignItems:"center", background:"transparent", border:"none", cursor:"pointer", padding:"7px 10px", fontFamily:"inherit" }}>
                <span style={{ fontSize:12, fontWeight:"bold", color:"#E8E8E8", textAlign:"left" }}>{a.name}</span>
                <span style={{ fontSize:12, color:"#E8E8E8", flexShrink:0 }}>{openId===a.id?"∧":"∨"}</span>
              </button>
              {openId===a.id&&(
                <div style={{ padding:"0 10px 10px 10px", display:"flex", flexDirection:"column", gap:5, borderTop:"1px solid #2A2A32", textAlign:"left" }}>
                  {a.body.map((b,i)=>(
                    <div key={i} style={{ fontSize:12, color:"#C8C8C8", lineHeight:1.65, marginTop:i===0?8:0, textAlign:"left" }} dangerouslySetInnerHTML={{ __html:b }} />
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </Collapsible>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// UNIT EDITOR MODAL
// ─────────────────────────────────────────────────────────────────────────────
function UnitEditorModal({ initial, onSave, onClose }) {
  const [name,setName]           = useState(initial?.name||"");
  const [faction,setFaction]     = useState(initial?.faction||"");
  const [keywords,setKeywords]   = useState(initial?.keywords||"");
  const [pts,setPts]             = useState(initial?.pts||"");
  const [stats,setStats]         = useState(initial?.stats||blankStats());
  const [weapons,setWeapons]     = useState(initial?.weapons?.length?initial.weapons:[blankWeapon()]);
  const [abilities,setAbilities] = useState(initial?.abilities||"");
  const [notes,setNotes]         = useState(initial?.notes||"");

  const setStat=(k,v)=>setStats(s=>({...s,[k]:v}));
  const updWeapon=(id,f,v)=>setWeapons(ws=>ws.map(w=>w.id===id?{...w,[f]:v}:w));
  const addWeapon=()=>setWeapons(ws=>[...ws,blankWeapon()]);
  const rmWeapon=(id)=>setWeapons(ws=>ws.filter(w=>w.id!==id));
  const handleSave=()=>{
    if(!name.trim()) return;
    onSave({ id:initial?.id||uid(), name:name.trim(), faction, keywords, pts, stats, weapons, abilities, notes });
    onClose();
  };

  return (
    <div style={S.overlay} onClick={onClose}>
      <div style={S.modal} onClick={e=>e.stopPropagation()}>
        <div style={{ ...S.gold, fontSize:13, marginBottom:14 }}>{initial?.id?"ユニット編集":"新規ユニット作成"} — データシート</div>

        <div style={{ marginBottom:10 }}>
          <div style={{ ...S.label, marginBottom:3 }}>ユニット名 *</div>
          <input style={S.input} value={name} onChange={e=>setName(e.target.value)} placeholder="例: スペースマリーン分隊" autoFocus />
        </div>
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"0 12px" }}>
          <div style={{ marginBottom:10 }}>
            <div style={{ ...S.label, marginBottom:3 }}>陣営</div>
            <select style={S.select} value={faction} onChange={e=>setFaction(e.target.value)}>
              <option value="">— 選択 —</option>
              {FACTIONS.map(f=><option key={f} value={f}>{f}</option>)}
            </select>
          </div>
          <div style={{ marginBottom:10 }}>
            <div style={{ ...S.label, marginBottom:3 }}>ポイントコスト</div>
            <input style={S.input} type="number" value={pts} onChange={e=>setPts(e.target.value)} placeholder="例: 100" />
          </div>
          <div style={{ gridColumn:"span 2", marginBottom:10 }}>
            <div style={{ ...S.label, marginBottom:3 }}>キーワード</div>
            <input style={S.input} value={keywords} onChange={e=>setKeywords(e.target.value)} placeholder="例: INFANTRY, CORE" />
          </div>
        </div>

        <div style={{ marginBottom:14 }}>
          <div style={{ ...S.label, marginBottom:4 }}>ステータス</div>
          <div style={S.statGrid}>
            {STAT_KEYS.map(k=>(
              <div key={k} style={S.statCell}>
                <div style={S.statCellLabel}>{k}</div>
                <input style={{ ...S.input, padding:"2px 2px", textAlign:"center", fontSize:13, fontWeight:"bold", color:"#D4AF37", border:"none", background:"transparent" }}
                  value={stats[k]} onChange={e=>setStat(k,e.target.value)} placeholder="—" />
              </div>
            ))}
          </div>
          <div style={{ display:"grid", gridTemplateColumns:"repeat(6,1fr)", gap:2, marginTop:3 }}>
            {STAT_KEYS.map(k=><div key={k} style={{ fontSize:8, color:"#8B8B8B", textAlign:"center" }}>{STAT_LABELS[k]}</div>)}
          </div>
        </div>

        <div style={{ marginBottom:14 }}>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:6 }}>
            <div style={S.label}>武器</div>
            <button style={S.outlineBtn("#D4AF37")} onClick={addWeapon}>+ 追加</button>
          </div>
          {weapons.map(w=>(
            <div key={w.id} style={{ background:"#0A0A0C", border:"1px solid #2A2A32", borderRadius:4, padding:10, marginBottom:6 }}>
              <div style={{ display:"grid", gridTemplateColumns:"1fr auto auto", gap:6, alignItems:"center", marginBottom:6 }}>
                <input style={S.input} value={w.name} onChange={e=>updWeapon(w.id,"name",e.target.value)} placeholder="武器名" />
                <select style={{ ...S.select, width:"auto" }} value={w.type} onChange={e=>updWeapon(w.id,"type",e.target.value)}>
                  <option>射撃</option><option>近接</option>
                </select>
                <button style={S.iconBtn("#C0392B")} onClick={()=>rmWeapon(w.id)}>✕</button>
              </div>
              <div style={{ display:"grid", gridTemplateColumns:"repeat(7,1fr)", gap:3 }}>
                {WPN_FIELDS.map(({key,label})=>(
                  <div key={key} style={S.statCell}>
                    <div style={{ ...S.statCellLabel, fontSize:8 }}>{label}</div>
                    <input style={{ ...S.input, padding:"1px 2px", textAlign:"center", fontSize:12, border:"none", background:"transparent" }}
                      value={w[key]} onChange={e=>updWeapon(w.id,key,e.target.value)} placeholder="—" />
                  </div>
                ))}
              </div>
              <input style={{ ...S.input, marginTop:6, fontSize:11 }} value={w.abilities}
                onChange={e=>updWeapon(w.id,"abilities",e.target.value)} placeholder="特殊ルール（例: ラピッドファイア 1）" />
            </div>
          ))}
        </div>

        <div style={{ marginBottom:10 }}>
          <div style={{ ...S.label, marginBottom:3 }}>アビリティ / 特殊ルール</div>
          <textarea style={{ ...S.input, resize:"vertical", minHeight:50 }} value={abilities} onChange={e=>setAbilities(e.target.value)} placeholder="例: 痛みを知らぬ者など" />
        </div>
        <div style={{ marginBottom:16 }}>
          <div style={{ ...S.label, marginBottom:3 }}>メモ</div>
          <textarea style={{ ...S.input, resize:"vertical", minHeight:34 }} value={notes} onChange={e=>setNotes(e.target.value)} placeholder="戦術メモなど" />
        </div>
        <div style={{ display:"flex", gap:8, justifyContent:"flex-end" }}>
          <button style={S.outlineBtn("#8B8B8B")} onClick={onClose}>キャンセル</button>
          <button style={S.solidBtn("#D4AF37")} onClick={handleSave}>保存</button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ROSTER LIBRARY MODAL
// ─────────────────────────────────────────────────────────────────────────────
function RosterModal({ roster, onEdit, onDelete, onCreate, onClose }) {
  const [search,setSearch]=useState("");
  const filtered=roster.filter(u=>
    u.name.toLowerCase().includes(search.toLowerCase())||
    (u.faction||"").toLowerCase().includes(search.toLowerCase())
  );
  return (
    <div style={S.overlay} onClick={onClose}>
      <div style={{ ...S.modal, maxWidth:640 }} onClick={e=>e.stopPropagation()}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:12 }}>
          <div style={{ ...S.gold, fontSize:13 }}>ユニットロスター — 保存済み</div>
          <button style={S.solidBtn("#D4AF37")} onClick={onCreate}>+ 新規作成</button>
        </div>
        <input style={{ ...S.input, marginBottom:10 }} value={search} onChange={e=>setSearch(e.target.value)} placeholder="名前・陣営で検索..." />
        {filtered.length===0
          ? <div style={{ textAlign:"center", padding:"24px 0", color:"#2A2A32", fontSize:13 }}>ユニットが登録されていません</div>
          : filtered.map(u=>(
            <div key={u.id} style={{ background:"#0A0A0C", border:"1px solid #2A2A32", borderRadius:4, padding:"10px 12px", marginBottom:6, display:"grid", gridTemplateColumns:"1fr auto", gap:8, alignItems:"center" }}>
              <div>
                <div style={{ fontSize:13, fontWeight:"bold", color:"#E8E8E8" }}>{u.name}</div>
                <div style={{ fontSize:10, color:"#8B8B8B", marginTop:2 }}>{[u.faction,u.pts?`${u.pts}pts`:null,u.keywords].filter(Boolean).join(" · ")}</div>
              </div>
              <div style={{ display:"flex", gap:5 }}>
                <button style={S.iconBtn()} onClick={()=>onEdit(u)}>✎</button>
                <button style={S.iconBtn("#C0392B")} onClick={()=>onDelete(u.id)}>✕</button>
              </div>
            </div>
          ))
        }
        <div style={{ marginTop:10, textAlign:"right" }}>
          <button style={S.outlineBtn("#8B8B8B")} onClick={onClose}>閉じる</button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// QUICK-ADD MODAL
// ─────────────────────────────────────────────────────────────────────────────
function QuickAddModal({ playerColor, playerName, roster, onAdd, onClose, onCreateNew }) {
  const [selected,setSelected]=useState(null);
  const [maxW,setMaxW]=useState("");
  const handleDeploy=()=>{
    if(!selected) return;
    const w=parseInt(maxW||selected.stats?.["傷"]||"1")||1;
    onAdd({ ...selected, id:uid(), maxWounds:w, currentWounds:w });
  };
  return (
    <div style={S.overlay} onClick={onClose}>
      <div style={{ ...S.modal, maxWidth:440 }} onClick={e=>e.stopPropagation()}>
        <div style={{ ...S.gold, fontSize:13, marginBottom:10 }}>ユニット配置 — {playerName}</div>
        {roster.length>0?(
          <>
            <div style={{ ...S.label, marginBottom:6 }}>ロスターから選択</div>
            <div style={{ maxHeight:240, overflowY:"auto", marginBottom:10 }}>
              {roster.map(u=>(
                <div key={u.id}
                  style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"7px 10px",
                    background:selected?.id===u.id?"#1A2A32":"#0A0A0C",
                    border:`1px solid ${selected?.id===u.id?playerColor:"#2A2A32"}`,
                    borderRadius:4, marginBottom:4, cursor:"pointer" }}
                  onClick={()=>setSelected(u)}>
                  <div>
                    <div style={{ fontSize:12, color:"#E8E8E8" }}>{u.name}</div>
                    <div style={{ fontSize:10, color:"#8B8B8B" }}>{[u.faction,u.pts?`${u.pts}pts`:null,u.stats?.["傷"]?`傷${u.stats["傷"]}`:null].filter(Boolean).join(" · ")}</div>
                  </div>
                  {selected?.id===u.id&&<span style={{ color:playerColor, fontSize:12 }}>✔</span>}
                </div>
              ))}
            </div>
            {selected&&(
              <div style={{ marginBottom:10 }}>
                <div style={{ ...S.label, marginBottom:3 }}>最大傷数（空欄で傷値を使用）</div>
                <input style={S.input} type="number" value={maxW} onChange={e=>setMaxW(e.target.value)} placeholder={selected.stats?.["傷"]||"例: 10"} />
              </div>
            )}
            <div style={{ display:"flex", gap:8, justifyContent:"flex-end" }}>
              <button style={S.outlineBtn("#8B8B8B")} onClick={onClose}>キャンセル</button>
              <button style={S.outlineBtn("#D4AF37")} onClick={onCreateNew}>新規作成</button>
              <button style={S.solidBtn(playerColor)} onClick={handleDeploy} disabled={!selected}>配置</button>
            </div>
          </>
        ):(
          <div style={{ textAlign:"center", padding:"20px 0" }}>
            <div style={{ color:"#8B8B8B", fontSize:12, marginBottom:14 }}>ロスターにユニットがありません</div>
            <button style={S.solidBtn("#D4AF37")} onClick={onCreateNew}>ユニットを作成</button>
          </div>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// UNIT DETAIL MODAL
// ─────────────────────────────────────────────────────────────────────────────
function UnitDetailModal({ unit, color, onWoundChange, onClose }) {
  const pct=unit.currentWounds/unit.maxWounds;
  return (
    <div style={S.overlay} onClick={onClose}>
      <div style={{ ...S.modal, maxWidth:560 }} onClick={e=>e.stopPropagation()}>
        <div style={{ borderBottom:`2px solid ${color}`, paddingBottom:10, marginBottom:14 }}>
          <div style={{ fontSize:15, fontWeight:"bold", color, letterSpacing:2, textTransform:"uppercase" }}>{unit.name}</div>
          <div style={{ fontSize:10, color:"#8B8B8B", marginTop:2 }}>{[unit.faction,unit.pts?`${unit.pts}pts`:null,unit.keywords].filter(Boolean).join(" · ")}</div>
        </div>
        <div style={{ textAlign:"center", marginBottom:16 }}>
          <div style={{ ...S.label, marginBottom:6 }}>傷 (負傷)</div>
          <div style={{ display:"flex", alignItems:"center", justifyContent:"center", gap:12 }}>
            <button style={{ ...S.iconBtn(S.woundColor(pct)), width:34, height:34, fontSize:18 }} onClick={()=>onWoundChange(unit.id,-1)}>−</button>
            <div>
              <div style={{ fontSize:36, fontWeight:"bold", color:S.woundColor(pct), lineHeight:1 }}>{unit.currentWounds}</div>
              <div style={{ fontSize:12, color:"#8B8B8B" }}>/ {unit.maxWounds}</div>
            </div>
            <button style={{ ...S.iconBtn(color), width:34, height:34, fontSize:18 }} onClick={()=>onWoundChange(unit.id,+1)} disabled={unit.currentWounds>=unit.maxWounds}>+</button>
          </div>
          <div style={{ height:6, background:"#2A2A32", borderRadius:3, marginTop:10, overflow:"hidden" }}>
            <div style={{ height:"100%", width:`${pct*100}%`, background:S.woundColor(pct), borderRadius:3, transition:"all .2s" }} />
          </div>
        </div>
        {STAT_KEYS.some(k=>unit.stats?.[k])&&(
          <div style={{ marginBottom:14 }}>
            <div style={{ ...S.label, marginBottom:4 }}>ステータス</div>
            <div style={S.statGrid}>
              {STAT_KEYS.map(k=><div key={k} style={S.statCell}><div style={S.statCellLabel}>{k}</div><div style={S.statCellVal}>{unit.stats?.[k]||"—"}</div></div>)}
            </div>
            <div style={{ display:"grid", gridTemplateColumns:"repeat(6,1fr)", gap:2, marginTop:3 }}>
              {STAT_KEYS.map(k=><div key={k} style={{ fontSize:8, color:"#8B8B8B", textAlign:"center" }}>{STAT_LABELS[k]}</div>)}
            </div>
          </div>
        )}
        {unit.weapons?.filter(w=>w.name).length>0&&(
          <div style={{ marginBottom:14 }}>
            <div style={{ ...S.label, marginBottom:6 }}>武器</div>
            <div style={{ overflowX:"auto" }}>
              <table style={{ width:"100%", borderCollapse:"collapse", fontSize:11, minWidth:380 }}>
                <thead>
                  <tr style={{ borderBottom:"1px solid #2A2A32" }}>
                    {["武器名","種別","射程","回","接","射","攻","貫","ダ"].map(h=>(
                      <th key={h} style={{ ...S.label, padding:"3px 4px", textAlign:"left", fontWeight:"normal", fontSize:9, whiteSpace:"nowrap" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {unit.weapons.filter(w=>w.name).map(w=>(
                    <tr key={w.id} style={{ borderBottom:"1px solid #2A2A3222" }}>
                      <td style={{ padding:"4px 4px", color:"#D4AF37" }}>{w.name}</td>
                      <td style={{ padding:"4px 4px", color:"#8B8B8B", fontSize:10 }}>{w.type}</td>
                      {["range","A","skill","BS","S","AP","D"].map(k=><td key={k} style={{ padding:"4px 4px" }}>{w[k]||"—"}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {unit.weapons.filter(w=>w.abilities).map(w=>(
              <div key={w.id} style={{ fontSize:10, color:"#8B8B8B", marginTop:3, paddingLeft:4 }}>[{w.name}] {w.abilities}</div>
            ))}
          </div>
        )}
        {unit.abilities&&<div style={{ marginBottom:10 }}><div style={{ ...S.label, marginBottom:3 }}>アビリティ</div><div style={{ fontSize:11, color:"#8B8B8B", background:"#0A0A0C", border:"1px solid #2A2A32", borderRadius:3, padding:8, whiteSpace:"pre-wrap" }}>{unit.abilities}</div></div>}
        {unit.notes&&<div style={{ marginBottom:10 }}><div style={{ ...S.label, marginBottom:3 }}>メモ</div><div style={{ fontSize:11, color:"#8B8B8B", background:"#0A0A0C", border:"1px solid #2A2A32", borderRadius:3, padding:8, whiteSpace:"pre-wrap" }}>{unit.notes}</div></div>}
        <button style={{ ...S.solidBtn(color), width:"100%", marginTop:4 }} onClick={onClose}>閉じる</button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// UNIT ROW
// ─────────────────────────────────────────────────────────────────────────────
function UnitRow({ unit, color, onWoundChange, onRemove, onDetail }) {
  const pct=unit.currentWounds/unit.maxWounds;
  const isDead=unit.currentWounds<=0;
  return (
    <div style={{ display:"grid", gridTemplateColumns:"1fr auto auto auto auto", gap:4, alignItems:"center", padding:"5px 7px", background:"#0A0A0C", border:`1px solid ${isDead?"#C0392B44":"#2A2A32"}`, borderRadius:4, marginBottom:3, opacity:isDead?0.55:1 }}>
      <button style={{ background:"none", border:"none", cursor:"pointer", textAlign:"left", padding:0, color:isDead?"#8B8B8B":"#E8E8E8", fontSize:11, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", fontFamily:"inherit" }}
        onClick={()=>onDetail(unit)} title="詳細">
        {unit.name}<span style={{ fontSize:9, color:"#8B8B8B" }}> ℹ</span>
      </button>
      {isDead
        ? <span style={{ fontSize:9, color:"#C0392B", letterSpacing:1, textTransform:"uppercase", whiteSpace:"nowrap" }}>撃滅</span>
        : <span style={{ fontSize:11, fontWeight:"bold", color:S.woundColor(pct), minWidth:40, textAlign:"center" }}>{unit.currentWounds}/{unit.maxWounds}</span>
      }
      <button style={S.iconBtn()} onClick={()=>onWoundChange(unit.id,-1)} disabled={isDead}>−</button>
      <button style={S.iconBtn(color)} onClick={()=>onWoundChange(unit.id,+1)} disabled={unit.currentWounds>=unit.maxWounds}>+</button>
      <button style={S.iconBtn("#C0392B")} onClick={()=>onRemove(unit.id)}>✕</button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// GAME OVER SCREEN
// ─────────────────────────────────────────────────────────────────────────────
function GameOverScreen({ players, reason, onReset }) {
  const winner=players[0].vp>players[1].vp?players[0]:players[1].vp>players[0].vp?players[1]:null;
  const wColor=winner?(winner===players[0]?PLAYER_COLORS[0]:PLAYER_COLORS[1]):null;
  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,.96)", display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", zIndex:300, gap:14, padding:20 }}>
      <div style={{ fontSize:10, color:"#8B8B8B", letterSpacing:4, textTransform:"uppercase" }}>バトル終了 — {reason}</div>
      <div style={{ height:1, background:"linear-gradient(90deg,transparent,#D4AF37,transparent)", width:"100%", maxWidth:300 }} />
      {winner
        ? <><div style={{ fontSize:26, fontWeight:"bold", letterSpacing:4, textTransform:"uppercase", color:wColor, textShadow:`0 0 30px ${wColor}`, textAlign:"center" }}>{winner.name}</div>
            <div style={{ fontSize:13, color:"#D4AF37", letterSpacing:3 }}>勝利！ — {winner.vp} VP</div></>
        : <div style={{ fontSize:22, fontWeight:"bold", color:"#D4AF37", letterSpacing:5 }}>引き分け</div>
      }
      <div style={{ display:"flex", gap:24, marginTop:4, flexWrap:"wrap", justifyContent:"center" }}>
        {players.map((p,i)=>(
          <div key={i} style={{ textAlign:"center" }}>
            <div style={{ fontSize:24, fontWeight:"bold", color:PLAYER_COLORS[i] }}>{p.vp}</div>
            <div style={{ fontSize:9, color:"#8B8B8B", letterSpacing:2, textTransform:"uppercase" }}>{p.name} VP</div>
          </div>
        ))}
      </div>
      <div style={{ height:1, background:"linear-gradient(90deg,transparent,#D4AF37,transparent)", width:"100%", maxWidth:300 }} />
      <button style={{ ...S.solidBtn("#D4AF37"), padding:"10px 28px", fontSize:13 }} onClick={onReset}>新しいバトル</button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// PRIMARY MISSION CARD (shared between both players)
// ─────────────────────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────────────────────
// MISSION DETAIL POPUP
// ─────────────────────────────────────────────────────────────────────────────
function MissionDetailPopup({ mission, onClose }) {
  if(!mission) return null;
  return (
    <div style={S.overlay} onClick={onClose}>
      <div style={{ ...S.modal, maxWidth:500, border:"1px solid #D4AF37" }} onClick={e=>e.stopPropagation()}>
        {/* Header */}
        <div style={{ borderBottom:"2px solid #D4AF37", paddingBottom:12, marginBottom:16 }}>
          <div style={{ fontSize:10, color:"#D4AF37", letterSpacing:3, textTransform:"uppercase", marginBottom:4 }}>主要目標</div>
          <div style={{ fontSize:20, fontWeight:"bold", color:"#E8E8E8", letterSpacing:1 }}>{mission.name}</div>
        </div>

        {/* Sections */}
        {(mission.sections||[]).map((sec,i)=>(
          <div key={i} style={{ marginBottom:14 }}>
            {sec.heading&&(
              <div style={{ background:"#2A2A32", borderRadius:3, padding:"5px 10px", fontSize:12, fontWeight:"bold", color:"#E8E8E8", marginBottom:8 }}>
                {sec.heading}
              </div>
            )}
            {(sec.rows||[]).map((row,j)=>(
              <div key={j} style={{ fontSize:12, color:"#C8C8C8", lineHeight:1.75, marginBottom:4, paddingLeft:sec.heading?4:0, borderBottom:"1px dotted #2A2A3A", paddingBottom:4, textAlign:"left" }}>
                {row.label&&<span style={{ fontWeight:"bold", color:"#E8E8E8" }}>{row.label}：</span>}
                <span dangerouslySetInnerHTML={{ __html:row.text }} />
              </div>
            ))}
          </div>
        ))}

        <div style={{ textAlign:"right", marginTop:8 }}>
          <button style={S.solidBtn("#D4AF37")} onClick={onClose}>閉じる</button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// PRIMARY MISSION CARD
// ─────────────────────────────────────────────────────────────────────────────
function PrimaryMissionCard({ roomId, mission, onReroll }) {
  const [panelOpen,  setPanelOpen]  = useState(true);
  const [detailOpen, setDetailOpen] = useState(false);

  return (
    <>
      <div style={{ ...S.card, border:"1px solid #D4AF3744", borderTop:"3px solid #D4AF37" }}>
        {/* Panel header */}
        <button onClick={()=>setPanelOpen(o=>!o)}
          style={{ width:"100%", display:"flex", justifyContent:"space-between", alignItems:"center", background:"transparent", border:"none", cursor:"pointer", padding:"2px 0", marginBottom:panelOpen?10:0, fontFamily:"inherit" }}>
          <div style={{ display:"flex", alignItems:"center", gap:8 }}>
            <span style={{ fontSize:13, color:"#D4AF37" }}>🎯</span>
            <span style={{ fontSize:12, fontWeight:"bold", color:"#D4AF37", letterSpacing:2, textTransform:"uppercase" }}>主要目標ミッション</span>
            <span style={{ fontSize:9, color:"#8B8B8B", letterSpacing:1 }}>（両プレイヤー共通）</span>
          </div>
          <span style={{ fontSize:13, color:"#D4AF37", transform:panelOpen?"rotate(180deg)":"rotate(0deg)", transition:"transform .2s", lineHeight:1 }}>∧</span>
        </button>

        {panelOpen&&(
          <div style={{ display:"flex", alignItems:"center", gap:8 }}>
            {/* Mission name button → open detail */}
            {mission ? (
              <button onClick={()=>setDetailOpen(true)}
                style={{ flex:1, background:"#0A0A0C", border:"1px solid #D4AF3766", borderRadius:4, padding:"10px 14px", textAlign:"left", cursor:"pointer", fontFamily:"inherit", display:"flex", alignItems:"center", gap:10 }}>
                <span style={{ fontSize:15, fontWeight:"bold", color:"#E8E8E8", letterSpacing:1 }}>{mission.name}</span>
                <span style={{ fontSize:10, color:"#D4AF37", marginLeft:"auto", whiteSpace:"nowrap" }}>詳細を見る →</span>
              </button>
            ) : (
              <div style={{ flex:1, background:"#0A0A0C", border:"1px dashed #2A2A3A", borderRadius:4, padding:"10px 14px" }}>
                <span style={{ fontSize:12, color:"#4A4A6A", fontStyle:"italic" }}>
                  {roomId ? "ミッションを抽選してください" : "ルームを作成するとランダムに決定されます"}
                </span>
              </div>
            )}
            {/* Reroll button */}
            {roomId&&(
              <button onClick={onReroll} title="ランダム抽選"
                style={{ ...S.outlineBtn("#D4AF37"), padding:"9px 12px", fontSize:13, flexShrink:0 }}>
                🎲
              </button>
            )}
          </div>
        )}
      </div>

      {detailOpen&&mission&&(
        <MissionDetailPopup mission={mission} onClose={()=>setDetailOpen(false)} />
      )}
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// PLAYER CARD
// ─────────────────────────────────────────────────────────────────────────────
function PlayerCard({ player, pIdx, isActive, isInRoom, onUpdate, onAddUnit, onDetail, onSurrender }) {
  const color=PLAYER_COLORS[pIdx];
  const [unitsOpen,setUnitsOpen]=useState(false);
  const [editingName,setEditingName]=useState(false);
  const [nameInput,setNameInput]=useState(player.name);
  const [secondaryOpen,setSecondaryOpen]=useState(false);
  const aliveCount=player.units.filter(u=>u.currentWounds>0).length;
  const pts=player.units.reduce((s,u)=>s+(parseInt(u.pts)||0),0);

  const commitName=()=>{
    if(nameInput.trim()&&nameInput.trim()!==player.name) onUpdate(p=>({...p,name:nameInput.trim()}));
    setEditingName(false);
  };

  return (
    <div style={{ ...S.card, border:`1px solid ${color}${isActive?"99":"33"}`, borderTop:`3px solid ${color}` }}>

      {/* Header */}
      <div style={{ display:"flex", alignItems:"center", gap:6, marginBottom:10, flexWrap:"nowrap" }}>
        <div style={{ width:7, height:7, background:color, borderRadius:"50%", boxShadow:`0 0 5px ${color}`, flexShrink:0 }} />
        {editingName?(
          <div style={{ display:"flex", gap:4, flex:1, minWidth:0 }}>
            <input style={{ ...S.input, fontSize:12, padding:"2px 6px" }} value={nameInput}
              onChange={e=>setNameInput(e.target.value)}
              onKeyDown={e=>{ if(e.key==="Enter") commitName(); if(e.key==="Escape") setEditingName(false); }}
              autoFocus />
            <button style={S.solidBtn(color)} onClick={commitName} >✔</button>
          </div>
        ):(
          <>
            <span style={{ fontSize:11, fontWeight:"bold", letterSpacing:1, textTransform:"uppercase", color:isActive?color:"#E8E8E8", flex:1, minWidth:0, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
              {player.name}
            </span>
            <button style={{ ...S.iconBtn("#8B8B8B"), flexShrink:0 }} onClick={()=>{ setNameInput(player.name); setEditingName(true); }} title="リネーム">✎</button>
            {isActive&&<span style={{ fontSize:9, color, border:`1px solid ${color}66`, borderRadius:3, padding:"1px 5px", whiteSpace:"nowrap", flexShrink:0 }}>▶ 行動中</span>}
          </>
        )}
      </div>

      {/* CP / VP / PTS */}
      <div style={{ display:"flex", gap:5, marginBottom:10 }}>
        {[["CP","cp",20],["VP","vp",100]].map(([lbl,key,max])=>(
          <div key={lbl} style={{ flex:1, background:"#0A0A0C", border:"1px solid #2A2A32", borderRadius:4, padding:"6px 4px", textAlign:"center" }}>
            <div style={{ ...S.label, marginBottom:3, fontSize:8 }}>{lbl}</div>
            <Counter value={player[key]} max={max} color={color} onChange={v=>onUpdate(p=>({...p,[key]:v}))} />
          </div>
        ))}
        <div style={{ background:"#0A0A0C", border:"1px solid #2A2A32", borderRadius:4, padding:"6px 4px", textAlign:"center", minWidth:44 }}>
          <div style={{ fontSize:8, color:"#8B8B8B", letterSpacing:1, textTransform:"uppercase", marginBottom:3 }}>コスト</div>
          <div style={{ fontSize:15, fontWeight:"bold", color:"#D4AF37", lineHeight:1.3 }}>{pts}</div>
        </div>
      </div>

      {/* Units collapsible */}
      <div>
        <button onClick={()=>setUnitsOpen(o=>!o)}
          style={{ width:"100%", display:"flex", justifyContent:"space-between", alignItems:"center", background:"transparent", border:"none", cursor:"pointer", padding:"4px 0", fontFamily:"inherit", marginBottom:unitsOpen?4:0 }}>
          <span style={{ ...S.label, fontSize:8 }}>ユニット ({aliveCount}/{player.units.length})</span>
          <div style={{ display:"flex", gap:6, alignItems:"center" }}>
            <button style={{ ...S.outlineBtn(color), fontSize:10, padding:"2px 7px" }}
              onClick={e=>{ e.stopPropagation(); onAddUnit(); }}>+ 配置</button>
            <span style={{ fontSize:11, color, transform:unitsOpen?"rotate(180deg)":"rotate(0deg)", transition:"transform .2s" }}>∧</span>
          </div>
        </button>
        {unitsOpen&&(
          <div style={{ maxHeight:200, overflowY:"auto" }}>
            {player.units.length===0
              ? <div style={{ fontSize:11, color:"#2A2A32", textAlign:"center", padding:"10px 0" }}>ユニットなし</div>
              : player.units.map(unit=>(
                <UnitRow key={unit.id} unit={unit} color={color}
                  onWoundChange={(id,d)=>onUpdate(p=>({...p,units:p.units.map(u=>u.id===id?{...u,currentWounds:Math.max(0,Math.min(u.maxWounds,u.currentWounds+d))}:u)}))}
                  onRemove={(id)=>onUpdate(p=>({...p,units:p.units.filter(u=>u.id!==id)}))}
                  onDetail={onDetail}
                />
              ))
            }
          </div>
        )}
      </div>

      {/* ── 副次目標 ── */}
      <div style={{ marginTop:8 }}>
        <button onClick={()=>setSecondaryOpen(o=>!o)}
          style={{ width:"100%", display:"flex", justifyContent:"space-between", alignItems:"center", background:"transparent", border:"none", cursor:"pointer", padding:"4px 0", fontFamily:"inherit" }}>
          <span style={{ fontSize:10, fontWeight:"bold", color, letterSpacing:2, textTransform:"uppercase" }}>
            副次目標ミッション
          </span>
          <span style={{ fontSize:11, color, transform:secondaryOpen?"rotate(180deg)":"rotate(0deg)", transition:"transform .2s", lineHeight:1 }}>∧</span>
        </button>
        {secondaryOpen&&(
          <div style={{ marginTop:4, display:"flex", flexDirection:"column", gap:4 }}>
            {[1,2].map(n=>(
              <div key={n} style={{ background:"#0A0A0C", border:"1px solid #2A2A3A", borderRadius:4, padding:"8px 10px" }}>
                <div style={{ fontSize:9, color:"#8B8B8B", letterSpacing:2, textTransform:"uppercase", marginBottom:4 }}>副次目標 {n}</div>
                <div style={{ fontSize:11, color:"#4A4A6A", fontStyle:"italic", textAlign:"center", padding:"6px 0" }}>Coming Soon</div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Surrender */}
      <div style={{ marginTop:8, textAlign:"right" }}>
        <button style={{ ...S.outlineBtn(color), fontSize:10, padding:"3px 8px" }} onClick={onSurrender}>🏳 投了</button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN APP
// ─────────────────────────────────────────────────────────────────────────────
export default function App() {
  const [user, setUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [isAllowed, setIsAllowed] = useState(false);
  // ── Battle state (synced via Firebase when in a room) ──
  const [players, setPlayers]             = useState([
    { name:"プレイヤー1", cp:0, vp:0, units:[] },
    { name:"プレイヤー2", cp:0, vp:0, units:[] },
  ]);
  const [currentTurn, setCurrentTurn]     = useState(1);
  const [activePlayer, setActivePlayer]   = useState(0);
  const [gameOver, setGameOver]           = useState(false);
  const [gameOverReason, setGameOverReason]= useState("");

  // ── Firebase room ──
  const [roomId, setRoomId]       = useState("");
  const [joinInput, setJoinInput] = useState("");
  const [syncing, setSyncing]     = useState(false);
  const isInRoom = !!roomId;
  const ignoreNextSnapshot = useRef(false); // prevent echo writes

  // ── Firebase roster ──
  const [roster, setRoster]           = useState([]);
  const [rosterLoaded, setRosterLoaded] = useState(false);

  // ── Primary mission ──
  const [missionList, setMissionList] = useState([]);   // all missions from Firestore
  const [mission,     setMission]     = useState(null); // currently selected mission

  // ── UI modals ──
  const [addingUnit,       setAddingUnit]       = useState(null);
  const [editingTemplate,  setEditingTemplate]  = useState(null);
  const [viewingUnit,      setViewingUnit]       = useState(null);
  const [showRoster,       setShowRoster]        = useState(false);
  const [confirmSurrender, setConfirmSurrender]  = useState(null);
  const [confirmLogout,    setConfirmLogout]      = useState(false);

  const login = async () => {
  const provider = new GoogleAuthProvider();
  await signInWithPopup(auth, provider);
  };
  const logout = async () => {
    setMission(null);
    await signOut(auth);
  };

  useEffect(() => {
  const unsub = onAuthStateChanged(auth, async (u) => {

    if (!u) {
      setUser(null);
      setIsAllowed(false);
      setAuthLoading(false);
      return;
    }

    setUser(u);

    try {
      const snap = await getDoc(
        doc(db, "allowedUsers", u.email)
      );

      setIsAllowed(snap.exists());

    } catch (err) {
      console.error(err);
      setIsAllowed(false);
    }

    setAuthLoading(false);
  });

  return unsub;
  }, []);

  // ── Load roster from Firestore on mount ──
  useEffect(()=>{
    const q=query(rosterCol(), orderBy("createdAt","asc"));
    const unsub=onSnapshot(q,(snap)=>{
      const data=snap.docs.map(d=>({ ...d.data(), _docId:d.id }));
      setRoster(data);
      setRosterLoaded(true);
    });
    return unsub;
  },[]);

  // ── Load primary missions list from Firestore ──
  useEffect(()=>{
    const q=query(missionsCol(), orderBy("order","asc"));
    const unsub=onSnapshot(q,(snap)=>{
      setMissionList(snap.docs.map(d=>({ id:d.id, ...d.data() })));
    });
    return unsub;
  },[]);

  // ── Subscribe to room's selected mission ──
  useEffect(()=>{
    if(!roomId) return;
    const unsub=onSnapshot(currentMission(roomId),(snap)=>{
      if(snap.exists()) setMission(snap.data());
      else setMission(null);
    });
    return unsub;
  },[roomId]);

  // ── Pick a random mission and save to room ──
  const rerollMission=async()=>{
    if(!roomId||missionList.length===0) return;
    const picked=missionList[Math.floor(Math.random()*missionList.length)];
    await setDoc(currentMission(roomId), picked);
  };

  // ── Save roster unit to Firestore ──
  const saveTemplate=async(unit)=>{
    const payload={ ...unit, createdAt:unit.createdAt||new Date().toISOString() };
    if(unit._docId){
      await updateDoc(rosterRef(unit._docId), payload);
    } else {
      const ref=await addDoc(rosterCol(), payload);
      // Firestore snapshot will update roster automatically
    }
  };
  const deleteTemplate=async(id)=>{
    // id is either the _docId (Firestore doc id) or unit.id
    const unit=roster.find(u=>u.id===id||u._docId===id);
    if(unit?._docId) await deleteDoc(rosterRef(unit._docId));
  };

  // ── Build current battle state object ──
  const getBattleState=()=>({
    players, currentTurn, activePlayer, gameOver, gameOverReason,
    updatedAt:new Date().toISOString(),
  });

  // ── Write battle state to Firestore ──
  const pushToFirebase=useCallback(async(state)=>{
    if(!roomId) return;
    ignoreNextSnapshot.current=true;
    await setDoc(roomRef(roomId), state, { merge:true });
  },[roomId]);

  // ── Subscribe to room changes ──
  useEffect(()=>{
    if(!roomId) return;
    const unsub=onSnapshot(roomRef(roomId),(snap)=>{
      if(!snap.exists()) return;
      if(ignoreNextSnapshot.current){ ignoreNextSnapshot.current=false; return; }
      const d=snap.data();
      if(d.players)       setPlayers(d.players);
      if(d.currentTurn!=null) setCurrentTurn(d.currentTurn);
      if(d.activePlayer!=null) setActivePlayer(d.activePlayer);
      if(d.gameOver!=null)    setGameOver(d.gameOver);
      if(d.gameOverReason!=null) setGameOverReason(d.gameOverReason);
    });
    return unsub;
  },[roomId]);

  // ── Create room (also auto-picks a random mission) ──
  const createRoom=async()=>{
    const id=genRoomId();
    const state={ ...defaultBattleState([players[0].name,players[1].name]), createdAt:new Date().toISOString() };
    await setDoc(roomRef(id), state);
    // auto-pick random mission
    if(missionList.length>0){
      const picked=missionList[Math.floor(Math.random()*missionList.length)];
      await setDoc(currentMission(id), picked);
    }
    setRoomId(id);
    setPlayers(state.players);
    setCurrentTurn(state.currentTurn);
    setActivePlayer(state.activePlayer);
    setGameOver(false); setGameOverReason("");
  };

  // ── Join room ──
  const joinRoom=async()=>{
    const id=joinInput.trim().toUpperCase();
    if(!id) return;
    const snap=await getDoc(roomRef(id));
    if(!snap.exists()){ alert("ルームが見つかりません"); return; }
    const d=snap.data();
    setRoomId(id);
    if(d.players)       setPlayers(d.players);
    if(d.currentTurn!=null) setCurrentTurn(d.currentTurn);
    if(d.activePlayer!=null) setActivePlayer(d.activePlayer);
    if(d.gameOver!=null)    setGameOver(d.gameOver);
    if(d.gameOverReason!=null) setGameOverReason(d.gameOverReason);
    setJoinInput("");
  };

  // ── Generic state updater that also pushes to Firebase ──
  const updateAndPush=(updater)=>{
    setPlayers(prev=>{
      const next=typeof updater==="function"?updater(prev):updater;
      const state={ ...getBattleState(), players:next };
      pushToFirebase(state);
      return next;
    });
  };

  const updatePlayer=(idx,fn)=>{
    updateAndPush(prev=>prev.map((p,i)=>i===idx?fn(p):p));
  };

  const updateGameState=(patch)=>{
    const nextTurn   = patch.currentTurn   ?? currentTurn;
    const nextAP     = patch.activePlayer  ?? activePlayer;
    const nextGO     = patch.gameOver      ?? gameOver;
    const nextGOR    = patch.gameOverReason?? gameOverReason;
    if(patch.currentTurn!=null)    setCurrentTurn(nextTurn);
    if(patch.activePlayer!=null)   setActivePlayer(nextAP);
    if(patch.gameOver!=null)       setGameOver(nextGO);
    if(patch.gameOverReason!=null) setGameOverReason(nextGOR);
    pushToFirebase({ players, currentTurn:nextTurn, activePlayer:nextAP, gameOver:nextGO, gameOverReason:nextGOR, updatedAt:new Date().toISOString() });
  };

  // ── CP grant (+1 both players) ──
  const handleCPGrant=useCallback(()=>{
    updateAndPush(prev=>prev.map(p=>({...p,cp:p.cp+1})));
  },[roomId]);

  // ── Add unit to player ──
  const handleAddUnit=(pIdx,template)=>{
    updatePlayer(pIdx,p=>({...p,units:[...p.units,template]}));
  };

  // ── Next turn — also grant +1 CP to both players each turn transition ──
  const nextTurn=()=>{
    // +1 CP to both players on every turn advance (指揮フェイズCP獲得ルール)
    const nextPlayers = players.map(p=>({ ...p, cp:p.cp+1 }));
    setPlayers(nextPlayers);

    let patch;
    if(activePlayer===0){
      patch={ activePlayer:1 };
    } else if(currentTurn>=TOTAL_TURNS){
      patch={ gameOver:true, gameOverReason:`全${TOTAL_TURNS}ターン完了` };
    } else {
      patch={ currentTurn:currentTurn+1, activePlayer:0 };
    }
    const nextTurnVal   = patch.currentTurn   ?? currentTurn;
    const nextAP        = patch.activePlayer  ?? activePlayer;
    const nextGO        = patch.gameOver      ?? gameOver;
    const nextGOR       = patch.gameOverReason?? gameOverReason;
    if(patch.currentTurn!=null)    setCurrentTurn(nextTurnVal);
    if(patch.activePlayer!=null)   setActivePlayer(nextAP);
    if(patch.gameOver!=null)       setGameOver(nextGO);
    if(patch.gameOverReason!=null) setGameOverReason(nextGOR);
    pushToFirebase({ players:nextPlayers, currentTurn:nextTurnVal, activePlayer:nextAP, gameOver:nextGO, gameOverReason:nextGOR, updatedAt:new Date().toISOString() });
  };

  // ── Surrender ──
  const handleSurrender=(pIdx)=>{
    setConfirmSurrender(null);
    updateGameState({ gameOver:true, gameOverReason:`${players[pIdx].name} 投了` });
  };

  // ── Reset game ──
  const resetGame=()=>{
    const state=defaultBattleState([players[0].name,players[1].name]);
    setPlayers(state.players);
    setCurrentTurn(1); setActivePlayer(0); setGameOver(false); setGameOverReason("");
    if(roomId) pushToFirebase({ ...state, updatedAt:new Date().toISOString() });
  };

  const activePColor=PLAYER_COLORS[activePlayer];

  if (authLoading) {
  return (
    <div style={{ minHeight:"100vh", background:"#0A0A0C", display:"flex", justifyContent:"center", alignItems:"center", fontFamily:"'Courier New','Courier',monospace" }}>
      <div style={{ textAlign:"center" }}>
        <div style={{ fontSize:13, fontWeight:"bold", color:"#D4AF37", letterSpacing:3, textTransform:"uppercase", textShadow:"0 0 20px rgba(212,175,55,.4)", marginBottom:16 }}>⚙ WH40K Battle Manager</div>
        <div style={{ fontSize:11, color:"#8B8B8B", letterSpacing:3, textTransform:"uppercase" }}>認証確認中...</div>
      </div>
    </div>
  );
  }

  if (!user) {
  return (
    <div style={{ minHeight:"100vh", background:"#0A0A0C", backgroundImage:"radial-gradient(ellipse at 50% 40%,rgba(212,175,55,.06) 0%,transparent 65%)", display:"flex", justifyContent:"center", alignItems:"center", padding:24, fontFamily:"'Courier New','Courier',monospace" }}>
      <div style={{ width:"100%", maxWidth:400, display:"flex", flexDirection:"column", alignItems:"center", gap:0 }}>

        {/* Emblem */}
        <div style={{ fontSize:40, marginBottom:16, filter:"drop-shadow(0 0 12px rgba(212,175,55,.5))" }}>⚙</div>

        {/* Title */}
        <div style={{ fontSize:18, fontWeight:"bold", color:"#D4AF37", letterSpacing:4, textTransform:"uppercase", textShadow:"0 0 20px rgba(212,175,55,.4)", textAlign:"center", marginBottom:4 }}>
          WH40K Battle Manager
        </div>
        <div style={{ fontSize:9, color:"#8B8B8B", letterSpacing:4, textTransform:"uppercase", marginBottom:32 }}>
          β版 対戦管理ツール（11版）
        </div>

        {/* Divider */}
        <div style={{ height:1, background:"linear-gradient(90deg,transparent,#D4AF37,transparent)", width:"100%", marginBottom:28 }} />

        {/* Notice */}
        <div style={{ background:"#1A1A1F", border:"1px solid #D4AF3744", borderLeft:"3px solid #D4AF37", borderRadius:4, padding:"12px 16px", marginBottom:28, width:"100%", boxSizing:"border-box" }}>
          <div style={{ fontSize:10, color:"#D4AF37", letterSpacing:2, textTransform:"uppercase", marginBottom:6 }}>⚠ アクセス制限</div>
          <div style={{ fontSize:12, color:"#C8C8C8", lineHeight:1.7 }}>
            このサービスは招待されたユーザー専用です。<br />
            Googleアカウントでログイン後、管理者によってアクセスが許可されたユーザーのみご利用いただけます。
          </div>
        </div>

        {/* Login button */}
        <button onClick={login}
          style={{ width:"100%", padding:"12px 0", background:"transparent", border:"1px solid #D4AF37", borderRadius:4, color:"#D4AF37", fontSize:13, fontWeight:"bold", fontFamily:"'Courier New','Courier',monospace", letterSpacing:2, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", gap:10, transition:"background .15s" }}
          onMouseOver={e=>e.currentTarget.style.background="rgba(212,175,55,.1)"}
          onMouseOut={e=>e.currentTarget.style.background="transparent"}>
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
            <path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615z" fill="#4285F4"/>
            <path d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332C2.438 15.983 5.482 18 9 18z" fill="#34A853"/>
            <path d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332z" fill="#FBBC05"/>
            <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0 5.482 0 2.438 2.017.957 4.958L3.964 6.29C4.672 4.163 6.656 3.58 9 3.58z" fill="#EA4335"/>
          </svg>
          Googleでログイン
        </button>

        {/* Divider */}
        <div style={{ height:1, background:"linear-gradient(90deg,transparent,#2A2A32,transparent)", width:"100%", marginTop:28 }} />
      </div>
    </div>
  );
  }

  if (!isAllowed) {
  return (
    <div style={{ minHeight:"100vh", background:"#0A0A0C", display:"flex", justifyContent:"center", alignItems:"center", padding:24, fontFamily:"'Courier New','Courier',monospace" }}>
      <div style={{ width:"100%", maxWidth:400, display:"flex", flexDirection:"column", alignItems:"center", gap:0 }}>
        <div style={{ fontSize:32, marginBottom:16 }}>🚫</div>
        <div style={{ fontSize:15, fontWeight:"bold", color:"#C0392B", letterSpacing:3, textTransform:"uppercase", marginBottom:24 }}>アクセス拒否</div>
        <div style={{ background:"#1A1A1F", border:"1px solid #C0392B44", borderLeft:"3px solid #C0392B", borderRadius:4, padding:"12px 16px", marginBottom:24, width:"100%", boxSizing:"border-box" }}>
          <div style={{ fontSize:12, color:"#C8C8C8", lineHeight:1.7 }}>
            <strong style={{ color:"#E8E8E8" }}>{user.email}</strong> はこのサービスへのアクセスが許可されていません。<br />
            招待を受けている場合は管理者にご連絡ください。
          </div>
        </div>
        <button onClick={logout}
          style={{ padding:"9px 24px", background:"transparent", border:"1px solid #8B8B8B", borderRadius:4, color:"#8B8B8B", fontSize:12, fontFamily:"'Courier New','Courier',monospace", letterSpacing:2, cursor:"pointer" }}
          onMouseOver={e=>e.currentTarget.style.borderColor="#E8E8E8"}
          onMouseOut={e=>e.currentTarget.style.borderColor="#8B8B8B"}>
          ログアウト
        </button>
      </div>
    </div>
  );
  }

  return (
    <div style={S.app}>
      {/* ── HEADER ── */}
      <div style={S.header}>
        <div style={{ minWidth:0 }}>
          <div style={S.headerTitle}>⚙ WARHAMMER 40K Battle Manager</div>
          <div style={S.headerSub}>β版 対戦管理ツール（11版）</div>
        </div>
        <div style={{ display:"flex", gap:6, alignItems:"center", flexShrink:0 }}>
          <button style={S.outlineBtn("#D4AF37")} onClick={()=>setShowRoster(true)}>📋 ロスター</button>
          {/* Turn badge */}
          <div style={{ background:"#1A1A1F", border:`2px solid ${activePColor}`, borderRadius:5, padding:"4px 10px", textAlign:"center", minWidth:68 }}>
            <div style={{ fontSize:10, color:activePColor, letterSpacing:1, textTransform:"uppercase", lineHeight:1, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", maxWidth:90 }}>
              {players[activePlayer].name}
            </div>
            <div style={{ fontSize:18, fontWeight:"bold", color:"#D4AF37", lineHeight:1.2 }}>T{currentTurn}/{TOTAL_TURNS}</div>
          </div>
          {/* User badge */}
          <div style={{ display:"flex", alignItems:"center", gap:5, background:"#1A1A1F", border:"1px solid #2A2A32", borderRadius:4, padding:"4px 8px", flexShrink:0, maxWidth:120 }}>
            {user.photoURL&&<img src={user.photoURL} alt="" style={{ width:18, height:18, borderRadius:"50%", flexShrink:0 }} />}
            <div style={{ minWidth:0 }}>
              <div style={{ fontSize:9, color:"#8B8B8B", letterSpacing:1, textTransform:"uppercase", lineHeight:1 }}>USER</div>
              <div style={{ fontSize:10, color:"#C8C8C8", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", maxWidth:80 }}>{user.displayName||user.email}</div>
            </div>
            <button onClick={()=>setConfirmLogout(true)} title="ログアウト"
              style={{ background:"transparent", border:"none", cursor:"pointer", color:"#8B8B8B", fontSize:10, padding:"0 2px", flexShrink:0, lineHeight:1 }}>⏻</button>
          </div>
        </div>
      </div>

      {/* ── ROOM BAR ── */}
      <div style={{ background:"#0F0F14", borderBottom:"1px solid #2A2A32", padding:"8px 14px", display:"flex", gap:8, flexWrap:"wrap", alignItems:"center" }}>
        {/* Room ID display */}
        {roomId&&(
          <div style={{ display:"flex", alignItems:"center", gap:6, background:"#1A1A1F", border:"1px solid #D4AF3766", borderRadius:4, padding:"4px 10px", flexShrink:0 }}>
            <span style={{ fontSize:9, color:"#8B8B8B", letterSpacing:2, textTransform:"uppercase" }}>ルームID</span>
            <span style={{ fontSize:14, fontWeight:"bold", color:"#D4AF37", letterSpacing:3, fontVariantNumeric:"tabular-nums" }}>{roomId}</span>
            <button style={{ ...S.iconBtn("#8B8B8B"), width:18, height:18, fontSize:10 }}
              onClick={()=>{ navigator.clipboard?.writeText(roomId); }} title="コピー">⧉</button>
          </div>
        )}

        {/* Join input */}
        {!roomId&&(
          <div style={{ display:"flex", gap:5, alignItems:"center", flex:1, minWidth:160, maxWidth:300 }}>
            <input
              style={{ ...S.input, fontSize:13, letterSpacing:3, textTransform:"uppercase", maxWidth:120, padding:"5px 8px" }}
              value={joinInput} onChange={e=>setJoinInput(e.target.value.toUpperCase())}
              placeholder="ルームID" maxLength={6}
              onKeyDown={e=>{ if(e.key==="Enter") joinRoom(); }}
            />
            <button style={{ ...S.solidBtn("#1A6B8A"), fontSize:11, padding:"5px 12px" }} onClick={joinRoom}>参加</button>
          </div>
        )}

        {/* Create room / leave */}
        {!roomId?(
          <button style={{ ...S.solidBtn("#6A5ACD"), fontSize:11, padding:"5px 12px" }} onClick={createRoom}>ルーム作成</button>
        ):(
          <button style={{ ...S.outlineBtn("#8B8B8B"), fontSize:11 }} onClick={()=>{ setRoomId(""); setMission(null); }}>退出</button>
        )}

        {/* Turn nav */}
        <div style={{ marginLeft:"auto", display:"flex", gap:8, alignItems:"center", flexWrap:"wrap" }}>
          <span style={{ fontSize:11, color:activePColor, fontWeight:"bold", whiteSpace:"nowrap" }}>
            {players[activePlayer].name}のターン
            <span style={{ color:"#8B8B8B", fontWeight:"normal" }}>　{currentTurn} / {TOTAL_TURNS}</span>
          </span>
          <button style={S.solidBtn("#D4AF37")} onClick={nextTurn}>
            {activePlayer===0?`${players[1].name}のターン →`:currentTurn>=TOTAL_TURNS?"ゲーム終了":`ターン${currentTurn+1}へ →`}
          </button>
        </div>
      </div>

      <div style={S.main}>
        {/* ── 主要目標ミッション（共通） ── */}
        <PrimaryMissionCard roomId={roomId} mission={mission} onReroll={rerollMission} />

        {/* ── PLAYERS (縦並び) ── */}
        <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
          {players.map((player,pIdx)=>(
            <PlayerCard key={pIdx} player={player} pIdx={pIdx}
              isActive={pIdx===activePlayer}
              isInRoom={isInRoom}
              onUpdate={(fn)=>updatePlayer(pIdx,fn)}
              onAddUnit={()=>setAddingUnit(pIdx)}
              onDetail={(u)=>setViewingUnit({ unit:u, pIdx })}
              onSurrender={()=>setConfirmSurrender(pIdx)}
            />
          ))}
        </div>

        {/* ── PHASE PANEL ── */}
        <PhasePanel />

        {/* ── STRATAGEMS ── */}
        <StratagemsPanel />

        {/* ── CORE ABILITIES ── */}
        <CoreAbilitiesPanel />
      </div>

      {/* ── MODALS ── */}
      {addingUnit!==null&&(
        <QuickAddModal playerColor={PLAYER_COLORS[addingUnit]} playerName={players[addingUnit].name} roster={roster}
          onAdd={(u)=>{ handleAddUnit(addingUnit,u); setAddingUnit(null); }}
          onClose={()=>setAddingUnit(null)}
          onCreateNew={()=>{ setAddingUnit(null); setEditingTemplate({ unit:null, deployTo:addingUnit }); }}
        />
      )}
      {editingTemplate!==null&&(
        <UnitEditorModal initial={editingTemplate.unit}
          onSave={(unit)=>{
            saveTemplate(unit);
            if(editingTemplate.deployTo!==undefined){
              const w=parseInt(unit.stats?.["傷"]||"1")||1;
              handleAddUnit(editingTemplate.deployTo,{ ...unit, id:uid(), maxWounds:w, currentWounds:w });
            }
          }}
          onClose={()=>setEditingTemplate(null)}
        />
      )}
      {showRoster&&(
        <RosterModal roster={roster}
          onEdit={(u)=>{ setShowRoster(false); setEditingTemplate({ unit:u }); }}
          onDelete={deleteTemplate}
          onCreate={()=>{ setShowRoster(false); setEditingTemplate({ unit:null }); }}
          onClose={()=>setShowRoster(false)}
        />
      )}
      {viewingUnit&&(
        <UnitDetailModal unit={viewingUnit.unit} color={PLAYER_COLORS[viewingUnit.pIdx]}
          onWoundChange={(id,d)=>updatePlayer(viewingUnit.pIdx,p=>({
            ...p, units:p.units.map(u=>u.id===id?{...u,currentWounds:Math.max(0,Math.min(u.maxWounds,u.currentWounds+d))}:u)
          }))}
          onClose={()=>setViewingUnit(null)}
        />
      )}

      {/* ── SURRENDER CONFIRM ── */}
      {confirmSurrender!==null&&(
        <div style={S.overlay} onClick={()=>setConfirmSurrender(null)}>
          <div style={{ ...S.modal, maxWidth:360 }} onClick={e=>e.stopPropagation()}>
            <div style={{ fontSize:14, fontWeight:"bold", color:"#C0392B", marginBottom:12 }}>🏳 投了確認</div>
            <div style={{ fontSize:13, color:"#C8C8C8", marginBottom:20, lineHeight:1.7 }}>
              <strong style={{ color:"#E8E8E8" }}>{players[confirmSurrender].name}</strong> が投了します。<br />
              現在のVPで勝敗を決定します。よろしいですか？
            </div>
            <div style={{ display:"flex", gap:8, justifyContent:"flex-end" }}>
              <button style={S.outlineBtn("#8B8B8B")} onClick={()=>setConfirmSurrender(null)}>キャンセル</button>
              <button style={S.dangerBtn} onClick={()=>handleSurrender(confirmSurrender)}>投了する</button>
            </div>
          </div>
        </div>
      )}

      {/* ── LOGOUT CONFIRM ── */}
      {confirmLogout&&(
        <div style={S.overlay} onClick={()=>setConfirmLogout(false)}>
          <div style={{ ...S.modal, maxWidth:340 }} onClick={e=>e.stopPropagation()}>
            <div style={{ fontSize:14, fontWeight:"bold", color:"#D4AF37", marginBottom:12 }}>⏻ ログアウト確認</div>
            <div style={{ fontSize:13, color:"#C8C8C8", marginBottom:24, lineHeight:1.7 }}>
              <strong style={{ color:"#E8E8E8" }}>{user.displayName||user.email}</strong><br />
              ログアウトしますか？
            </div>
            <div style={{ display:"flex", gap:8, justifyContent:"flex-end" }}>
              <button style={S.outlineBtn("#8B8B8B")} onClick={()=>setConfirmLogout(false)}>キャンセル</button>
              <button style={S.solidBtn("#D4AF37")} onClick={()=>{ setConfirmLogout(false); logout(); }}>ログアウト</button>
            </div>
          </div>
        </div>
      )}

      {/* ── GAME OVER ── */}
      {gameOver&&<GameOverScreen players={players} reason={gameOverReason} onReset={resetGame} />}
    </div>
  );
}
