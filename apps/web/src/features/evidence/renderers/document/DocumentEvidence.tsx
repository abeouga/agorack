import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { FiFileText, FiInfo, FiMinus, FiPlus } from "react-icons/fi";
import { Spinner } from "../../../../shared/Spinner";
import { evidenceKey, valueText } from "../../selection";
import { FallbackEvidence } from "../fallback/FallbackEvidence";
import type { EvidenceViewProps } from "../types";
import { type DocumentLocation, boxStyle, documentLocation } from "./location";
import "./document.css";

/** 拡大の段階（1 ＝ 欄の幅に合わせる） */
const ZOOMS = [1, 1.5, 2, 3] as const;

export const NO_LOCATION_NOTICE = "この根拠には、ページ画像の場所がありません。";
export const IMAGE_FAILED_NOTICE =
  "ページ画像を読めませんでした。部品（文之助など）が止まっているか、書類の画像がありません。";

/** 埋め込めなかった知らせと、ラベルと値の表示に戻した理由を、1つの知らせにまとめる */
const joinNotices = (...notices: (string | undefined)[]) => notices.filter(Boolean).join(" ");

/**
 * 書類の根拠：ページ画像（location.image_url）に欄の枠（location.box）を描く（設計 §7.3）。
 * 見た目は、部品の画面の中の書類の表示（文之助の PageViewer）にそろえる：
 * 上に道具の行（左に書類の名前、右に拡大・縮小）、その下にページ画像を右の欄の高さいっぱいに出す。
 * 同じページにある、同じ答えの根拠の枠をまとめて強調し、出している根拠の枠を一番強くする。
 * 画像の場所がない・読めないときは、ラベルと値の表示に戻す。
 * ページ画像は部品のサーバーから直に読む（文之助は 127.0.0.1:8010）。
 */
export function DocumentEvidence(props: EvidenceViewProps) {
  const { evidence, sourceName, notice } = props;
  const location = documentLocation(evidence);
  // 読めなかった画像（同じ画像を何度も読みに行かない）
  const [failed, setFailed] = useState<ReadonlySet<string>>(new Set());
  if (!location) {
    return (
      <FallbackEvidence
        evidence={evidence}
        sourceName={sourceName}
        notice={joinNotices(notice, NO_LOCATION_NOTICE)}
      />
    );
  }
  if (failed.has(location.imageUrl)) {
    return (
      <FallbackEvidence
        evidence={evidence}
        sourceName={sourceName}
        notice={joinNotices(notice, IMAGE_FAILED_NOTICE)}
      />
    );
  }
  return (
    <DocumentPage
      {...props}
      key={location.imageUrl}
      location={location}
      onFailed={(url) => setFailed((current) => new Set(current).add(url))}
    />
  );
}

function DocumentPage({
  evidence,
  siblings,
  highlighted,
  sourceName,
  notice,
  onPick,
  location,
  onFailed,
}: EvidenceViewProps & { location: DocumentLocation; onFailed: (imageUrl: string) => void }) {
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  const [zoom, setZoom] = useState<number>(1);
  const image = useRef<HTMLImageElement>(null);
  const frame = useRef<HTMLDivElement>(null);
  const focusKey = evidenceKey(evidence);

  // 同じページにある根拠の枠
  const boxes = siblings.flatMap((item) => {
    const at = documentLocation(item);
    return at && at.imageUrl === location.imageUrl
      ? [{ key: evidenceKey(item), item, box: at.box }]
      : [];
  });

  // 読み込み済み（キャッシュにある）画像は、onLoad の前に大きさを取る
  useLayoutEffect(() => {
    const loaded = image.current;
    if (loaded?.complete && loaded.naturalWidth > 0) {
      setSize({ width: loaded.naturalWidth, height: loaded.naturalHeight });
    }
  }, []);

  // 出している枠が見えるところまで動かす
  useEffect(() => {
    const scroller = frame.current;
    const element = scroller?.querySelector<HTMLElement>(".document-box.is-focus");
    if (!scroller || !element || !size) return;
    const outer = scroller.getBoundingClientRect();
    const inner = element.getBoundingClientRect();
    const visible =
      inner.top >= outer.top &&
      inner.bottom <= outer.bottom &&
      inner.left >= outer.left &&
      inner.right <= outer.right;
    if (visible) return;
    scroller.scrollTo({
      top: scroller.scrollTop + inner.top - outer.top - (outer.height - inner.height) / 2,
      left: scroller.scrollLeft + inner.left - outer.left - (outer.width - inner.width) / 2,
      behavior: "smooth",
    });
  }, [focusKey, size, zoom]);

  const value = valueText(evidence.value);
  const zoomIndex = ZOOMS.indexOf(zoom as (typeof ZOOMS)[number]);
  return (
    <div className="document-evidence">
      <div className="document-tools">
        <h2 className="document-title" title={location.documentTitle ?? undefined}>
          <FiFileText aria-hidden="true" />
          <span>{location.documentName ?? location.documentTitle ?? sourceName}</span>
        </h2>
        <div className="document-zoom" role="group" aria-label="表示の倍率">
          <button
            type="button"
            aria-label="縮小"
            disabled={zoomIndex <= 0}
            onClick={() => setZoom(ZOOMS[Math.max(zoomIndex - 1, 0)] ?? 1)}
          >
            <FiMinus aria-hidden="true" />
          </button>
          <span>{Math.round(zoom * 100)}%</span>
          <button
            type="button"
            aria-label="拡大"
            disabled={zoomIndex >= ZOOMS.length - 1}
            onClick={() => setZoom(ZOOMS[Math.min(zoomIndex + 1, ZOOMS.length - 1)] ?? zoom)}
          >
            <FiPlus aria-hidden="true" />
          </button>
        </div>
      </div>
      {notice && (
        <p className="document-notice" role="status">
          <FiInfo aria-hidden="true" />
          {notice}
        </p>
      )}
      {/* 枠は目で見るだけなので、出している欄と値を読み上げ用に添える */}
      <p className="sr-only" aria-live="polite">
        {location.documentTitle ?? sourceName}の{location.fieldLabel ?? evidence.label}：
        {value ?? "空欄"}
      </p>
      <div className="document-scroll" ref={frame}>
        {!size && (
          <p className="document-loading" role="status">
            <Spinner />
            ページ画像を読み込んでいます…
          </p>
        )}
        <div className="document-stage" style={{ width: `${zoom * 100}%` }}>
          <img
            ref={image}
            src={location.imageUrl}
            alt={`${location.documentTitle ?? "書類"}のページ画像`}
            draggable={false}
            onLoad={(event) =>
              setSize({
                width: event.currentTarget.naturalWidth,
                height: event.currentTarget.naturalHeight,
              })
            }
            onError={() => onFailed(location.imageUrl)}
          />
          {size &&
            boxes.map(({ key, item, box }) => {
              const classes = [
                "document-box",
                key === focusKey ? "is-focus" : "",
                highlighted.has(key) ? "is-highlighted" : "",
              ];
              return (
                <button
                  key={key}
                  type="button"
                  tabIndex={-1}
                  className={classes.join(" ").replace(/\s+/g, " ").trim()}
                  style={boxStyle(box, size)}
                  title={`${item.label}：${valueText(item.value) ?? "空欄"}`}
                  aria-label={`${item.label}を選ぶ`}
                  onClick={() => onPick(key)}
                />
              );
            })}
        </div>
      </div>
    </div>
  );
}
