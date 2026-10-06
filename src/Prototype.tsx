import { useEffect, useRef, useState } from "react";
import {
  ArrowLeftIcon,
  CameraIcon,
  CheckCircledIcon,
  Cross2Icon,
  DownloadIcon,
  FileTextIcon,
  GearIcon,
  ImageIcon,
  LightningBoltIcon,
  MagicWandIcon,
  PlusIcon,
  ReaderIcon,
  TrashIcon,
  ReloadIcon as RotateClockwiseIcon,
  MagnifyingGlassIcon,
} from "@radix-ui/react-icons";
import {
  BottomSheet,
  Carousel,
  KeyboardInput,
  MobileScroll,
  useKeyboard,
} from "./mobile";
import {
  detectDocument,
  importImage,
  loadImage,
  processImage,
  rotateImage,
  splitBook,
  type Quad,
  type ImageFilter,
} from "./scanner/vision";
import { recognizeText } from "./scanner/ocr";
import { downloadBlob, downloadText } from "./scanner/download";
import type { CurveOptions, MaskRegion } from "./scanner/book-enhancement";
import {
  listDocuments,
  saveDocument,
  deleteDocument,
  newDocument,
  type ScanPage,
  type ScanDocument,
} from "./scanner/storage";

const SAMPLE = "/assets/app/book-camera-preview.png";
const MODES = ["자동", "책", "문서"] as const;
const FILTERS: { id: ImageFilter; label: string }[] = [
  { id: "auto", label: "자동" },
  { id: "original", label: "원본" },
  { id: "document", label: "문서" },
  { id: "bw", label: "흑백" },
  { id: "gray", label: "회색" },
  { id: "photo", label: "사진" },
];
type Sheet =
  "ocr" | "export" | "settings" | "crop" | "save" | "delete" | "cleanup" | null;
type View = "camera" | "review" | "library";
type CleanupOptions = { curve: CurveOptions; regions: MaskRegion[] };
type CleanupPreview = { original: string; image: string };
type CleanupDraft = {
  source: string;
  image: string;
  width: number;
  height: number;
  curve: CurveOptions | null;
  regions: MaskRegion[];
  warnings: string[];
};

function BookCleanupPanel({
  draft,
  busy,
  onPreview,
  onApply,
}: {
  draft: CleanupDraft;
  busy: boolean;
  onPreview: (
    options: CleanupOptions,
  ) => Promise<CleanupPreview | { error: string }>;
  onApply: (preview: CleanupPreview) => void;
}) {
  const [curve, setCurve] = useState<CurveOptions>(
    draft.curve ?? { amount: 0, edge: "left" },
  );
  const [regions, setRegions] = useState<MaskRegion[]>([]);
  const [activeRegion, setActiveRegion] = useState<string | null>(null);
  const [preview, setPreview] = useState<CleanupPreview | null>(null);
  const [before, setBefore] = useState(true);
  const [error, setError] = useState("");
  const changeCurve = (next: CurveOptions) => {
    setCurve(next);
    setPreview(null);
    setBefore(true);
    setError("");
  };
  const changeRegions = (next: MaskRegion[]) => {
    setRegions(next);
    setPreview(null);
    setBefore(true);
    setError("");
  };
  const selectedRegion = regions.find((region) => region.id === activeRegion);
  const anyChanges = curve.amount !== 0 || regions.length > 0;
  return (
    <div className="cleanup-panel">
      <div className="cleanup-image">
        <img
          src={preview && !before ? preview.image : draft.image}
          alt={preview && !before ? "책 보정 미리보기" : "책 보정 전 이미지"}
          draggable="false"
        />
        {before && (
          <svg
            viewBox={`0 0 ${draft.width} ${draft.height}`}
            aria-hidden="true"
          >
            {draft.regions
              .filter(
                (candidate) =>
                  !regions.some((region) => region.id === candidate.id),
              )
              .map((candidate, index) => (
                <g key={candidate.id}>
                  <rect
                    x={candidate.x * draft.width}
                    y={candidate.y * draft.height}
                    width={candidate.width * draft.width}
                    height={candidate.height * draft.height}
                    fill="none"
                    stroke="#bc811b"
                    strokeWidth="2"
                    strokeDasharray="4 3"
                    vectorEffect="non-scaling-stroke"
                  />
                  <text
                    x={(candidate.x + 0.01) * draft.width}
                    y={(candidate.y + 0.025) * draft.height}
                    fill="#835700"
                    fontSize={draft.width * 0.035}
                  >
                    {draft.regions.indexOf(candidate) + 1}
                  </text>
                </g>
              ))}
            {regions.map((region, index) => (
              <g key={region.id}>
                <rect
                  x={region.x * draft.width}
                  y={region.y * draft.height}
                  width={region.width * draft.width}
                  height={region.height * draft.height}
                  fill="#e4645633"
                  stroke="#d7493b"
                  strokeWidth="2"
                  vectorEffect="non-scaling-stroke"
                />
                <text
                  x={(region.x + 0.015) * draft.width}
                  y={(region.y + 0.025) * draft.height}
                  fill="#b02722"
                  fontSize={draft.width * 0.035}
                >
                  {index + 1}
                </text>
              </g>
            ))}
          </svg>
        )}
      </div>
      {preview && (
        <div className="page-tools" aria-label="보정 전후 비교">
          <button aria-pressed={before} onClick={() => setBefore(true)}>
            보정 전
          </button>
          <button aria-pressed={!before} onClick={() => setBefore(false)}>
            보정 후
          </button>
        </div>
      )}
      <p className="cleanup-warning">
        실험적 로컬 보정입니다. 가린 영역의 글자는 복원하지 않아요. 반드시
        미리보기와 원문을 확인하세요.
      </p>
      {draft.warnings.length > 0 && (
        <ul className="cleanup-hints">
          {draft.warnings.map((warning, index) => (
            <li key={index}>{warning}</li>
          ))}
        </ul>
      )}
      <section className="cleanup-section">
        <h3>곡률 보정</h3>
        <p className="privacy-note">
          {draft.curve
            ? "문자 줄의 휘어짐에서 조정값을 제안했어요."
            : "휘어짐을 확실히 추정하지 못했어요. 수동으로 조정하세요."}
        </p>
        <label className="cleanup-slider">
          휘어짐 강도 <output>{Math.round(curve.amount * 100)}</output>
          <input
            type="range"
            data-scroll-drag="ignore"
            aria-label="휘어짐 강도"
            min={-100}
            max={100}
            step={1}
            value={Math.round(curve.amount * 100)}
            disabled={busy}
            onChange={(event) =>
              changeCurve({
                ...curve,
                amount: Number(event.target.value) / 100,
              })
            }
          />
        </label>
        <div className="page-tools" aria-label="보정 방향">
          {(
            [
              { edge: "left", label: "왼쪽 책등" },
              { edge: "right", label: "오른쪽 책등" },
              { edge: "both", label: "양쪽" },
            ] as const
          ).map((item) => (
            <button
              key={item.edge}
              aria-pressed={curve.edge === item.edge}
              disabled={busy}
              onClick={() => changeCurve({ ...curve, edge: item.edge })}
            >
              {item.label}
            </button>
          ))}
          <button
            disabled={busy}
            onClick={() => changeCurve({ amount: 0, edge: curve.edge })}
          >
            곡률 끄기
          </button>
        </div>
      </section>
      <section className="cleanup-section">
        <h3>손가락 영역 가리기</h3>
        <p className="privacy-note">
          가장자리 피부색 후보를 제안합니다. 글자나 사진을 잘못 선택할 수
          있어요. 후보는 선택 전까지 적용하지 않습니다.
        </p>
        {draft.regions.length === 0 ? (
          <p className="privacy-note">
            후보가 없어요. 필요하면 직접 영역을 추가하세요.
          </p>
        ) : (
          <div className="cleanup-candidates">
            {draft.regions.map((region, index) => {
              const chosen = regions.some((item) => item.id === region.id);
              return (
                <button
                  key={region.id}
                  aria-pressed={chosen}
                  disabled={busy || (!chosen && regions.length >= 6)}
                  onClick={() => {
                    changeRegions(
                      chosen
                        ? regions.filter((item) => item.id !== region.id)
                        : [...regions, region],
                    );
                    setActiveRegion(chosen ? null : region.id);
                  }}
                >
                  후보 {index + 1} {chosen ? "해제" : "선택"}
                </button>
              );
            })}
          </div>
        )}
        <button
          className="secondary-action full-width"
          disabled={busy || regions.length >= 6}
          onClick={() => {
            const region: MaskRegion = {
              id: crypto.randomUUID(),
              x: 0,
              y: 0.35,
              width: 0.12,
              height: 0.18,
            };
            changeRegions([...regions, region]);
            setActiveRegion(region.id);
          }}
        >
          가릴 영역 추가
        </button>
        {regions.length > 0 && (
          <div className="cleanup-candidates" aria-label="선택한 가림 영역">
            {regions.map((region, index) => (
              <button
                key={region.id}
                aria-pressed={activeRegion === region.id}
                disabled={busy}
                onClick={() => {
                  setActiveRegion(region.id);
                  setBefore(true);
                }}
              >
                영역 {index + 1} 편집
              </button>
            ))}
          </div>
        )}
        {selectedRegion && (
          <fieldset className="cleanup-region-editor">
            <legend>가림 영역 조정</legend>
            {(
              [
                { key: "x", label: "가로 위치" },
                { key: "y", label: "세로 위치" },
                { key: "width", label: "영역 너비" },
                { key: "height", label: "영역 높이" },
              ] as const
            ).map((item) => (
              <label key={item.key} className="cleanup-slider">
                {item.label}
                <output>{Math.round(selectedRegion[item.key] * 100)}%</output>
                <input
                  type="range"
                  data-scroll-drag="ignore"
                  aria-label={item.label}
                  min={item.key === "x" || item.key === "y" ? 0 : 2}
                  max={
                    item.key === "x"
                      ? Math.floor((1 - selectedRegion.width) * 100)
                      : item.key === "y"
                        ? Math.floor((1 - selectedRegion.height) * 100)
                        : item.key === "width"
                          ? Math.floor((1 - selectedRegion.x) * 100)
                          : Math.floor((1 - selectedRegion.y) * 100)
                  }
                  step={1}
                  disabled={busy}
                  value={Math.round(selectedRegion[item.key] * 100)}
                  onChange={(event) =>
                    changeRegions(
                      regions.map((region) =>
                        region.id === selectedRegion.id
                          ? {
                              ...region,
                              [item.key]: Number(event.target.value) / 100,
                            }
                          : region,
                      ),
                    )
                  }
                />
              </label>
            ))}
            <button
              className="text-button cleanup-remove"
              disabled={busy}
              onClick={() => {
                changeRegions(
                  regions.filter((region) => region.id !== selectedRegion.id),
                );
                setActiveRegion(null);
              }}
            >
              이 영역 제거
            </button>
          </fieldset>
        )}
      </section>
      {error && (
        <p className="cleanup-error" role="alert">
          {error}
        </p>
      )}
      <div className="cleanup-actions">
        <button
          className="secondary-action full-width"
          disabled={busy || !anyChanges}
          onClick={() =>
            void onPreview({ curve, regions }).then((result) => {
              if ("error" in result) {
                setError(result.error);
                setPreview(null);
              } else {
                setError("");
                setPreview(result);
                setBefore(false);
              }
            })
          }
        >
          보정 미리보기
        </button>
        <button
          className="sheet-primary"
          disabled={busy || !preview}
          onClick={() => preview && onApply(preview)}
        >
          이 결과 적용
        </button>
      </div>
      <p className="privacy-note">
        최대 6개 영역 · 영역당 15%, 합계 25% 이하만 가릴 수 있어요. 적용 전에는
        페이지와 OCR을 변경하지 않습니다.
      </p>
      <p className="privacy-note">
        되돌리기용 원본은 기기에 남습니다. 개인정보를 영구 삭제하는 보안 마스킹
        용도로 사용하지 마세요.
      </p>
    </div>
  );
}
async function preparePages(source: string, book: boolean) {
  const detected = await detectDocument(source);
  const corrected = await processImage(
    source,
    detected ?? undefined,
    "original",
  );
  const originals = book ? await splitBook(corrected) : [corrected];
  const pages: ScanPage[] = [];
  // Preserve the unfiltered corrected image: changing filters must not compound edits.
  for (const original of originals)
    pages.push({
      id: crypto.randomUUID(),
      image: await processImage(original, undefined, "auto"),
      original,
      filter: "auto",
    });
  return { pages, detected };
}
const errorMessage = (error: unknown) => {
  if (error instanceof DOMException && error.name === "NotAllowedError")
    return "카메라 권한이 거부됐어요. 브라우저에서 허용하거나 사진 가져오기를 이용하세요.";
  if (error instanceof DOMException && error.name === "NotFoundError")
    return "사용 가능한 카메라가 없어요. 사진 가져오기를 이용하세요.";
  return error instanceof Error ? error.message : "처리 중 오류가 발생했어요.";
};

export default function Prototype() {
  const [view, setView] = useState<View>("camera");
  const [mode, setMode] = useState<(typeof MODES)[number]>("문서");
  const [pages, setPages] = useState<ScanPage[]>([]);
  const [active, setActive] = useState(0);
  const [sheet, setSheet] = useState<Sheet>(null);
  const [busy, setBusy] = useState("");
  const [progress, setProgress] = useState(0);
  const [notice, setNotice] = useState("");
  const [live, setLive] = useState(false);
  const [auto, setAuto] = useState(false);
  const [flash, setFlash] = useState(false);
  const [quad, setQuad] = useState<Quad | null>(null);
  const [cropQuad, setCropQuad] = useState<Quad | null>(null);
  const [cropSize, setCropSize] = useState({ width: 1, height: 1 });
  const [cleanupDraft, setCleanupDraft] = useState<CleanupDraft | null>(null);
  const [documents, setDocuments] = useState<ScanDocument[]>([]);
  const [query, setQuery] = useState("");
  const [title, setTitle] = useState("");
  const [tags, setTags] = useState("");
  const [documentId, setDocumentId] = useState<string | null>(null);
  const [createdAt, setCreatedAt] = useState(0);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [quality, setQuality] = useState<"high" | "compact">("high");
  const videoRef = useRef<HTMLVideoElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const busyRef = useRef(false);
  const mountedRef = useRef(true);
  const keyboard = useKeyboard();
  const selected = pages[active];
  const navigate = (next: View) => {
    keyboard.hide();
    setSheet(null);
    setCleanupDraft(null);
    setNotice("");
    setView(next);
  };
  const openSheet = (next: Sheet) => {
    keyboard.hide();
    setNotice("");
    setSheet(next);
  };
  const closeSheet = (open: boolean) => {
    if (!open && !busyRef.current) {
      setSheet(null);
      setCleanupDraft(null);
    }
  };
  const stopCamera = () => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setLive(false);
    setQuad(null);
    setFlash(false);
  };
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      streamRef.current?.getTracks().forEach((track) => track.stop());
    };
  }, []);
  useEffect(() => {
    if (view !== "camera") stopCamera();
  }, [view]);
  useEffect(() => {
    if (!live || !videoRef.current) return;
    videoRef.current.srcObject = streamRef.current;
    videoRef.current
      .play()
      .catch(() => setNotice("카메라 재생을 시작할 수 없어요."));
  }, [live, view]);
  useEffect(() => {
    if (view !== "library") return;
    let cancelled = false;
    listDocuments(query)
      .then((result) => {
        if (!cancelled) setDocuments(result);
      })
      .catch((error) => {
        if (!cancelled) setNotice(errorMessage(error));
      });
    return () => {
      cancelled = true;
    };
  }, [view, query]);

  const run = async (label: string, job: () => Promise<void>) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(label);
    setNotice("");
    setProgress(0);
    try {
      await job();
    } catch (error) {
      if (mountedRef.current) setNotice(errorMessage(error));
    } finally {
      busyRef.current = false;
      if (mountedRef.current) {
        setBusy("");
        setProgress(0);
      }
    }
  };
  const startCamera = async () => {
    await run("카메라 연결 중", async () => {
      if (!navigator.mediaDevices?.getUserMedia)
        throw new Error(
          "카메라는 HTTPS 또는 localhost에서 사용할 수 있어요. 사진 가져오기를 이용하세요.",
        );
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
        audio: false,
      });
      if (!mountedRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = stream;
      setLive(true);
    });
  };
  const captureFrame = () => {
    const video = videoRef.current;
    if (!video?.videoWidth)
      throw new Error("카메라가 준비될 때까지 기다려 주세요.");
    const scale = Math.min(
      1,
      2200 / Math.max(video.videoWidth, video.videoHeight),
    );
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    canvas
      .getContext("2d")!
      .drawImage(video, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.9);
  };
  const appendImage = async (source: string) => {
    if (pages.length >= 20)
      throw new Error("문서당 최대 20페이지까지 저장할 수 있어요.");
    const { pages: added, detected } = await preparePages(
      source,
      mode === "책",
    );
    if (pages.length + added.length > 20)
      throw new Error("책 스캔에는 2페이지의 여유가 필요해요.");
    setPages((previous) => [...previous, ...added]);
    setActive(pages.length);
    navigate("review");
    if (!detected)
      setNotice(
        "경계를 확실히 찾지 못해 전체 이미지를 사용했어요. 자르기로 조정할 수 있어요.",
      );
  };
  const capture = () =>
    run("문서 보정 중", async () => {
      if (!live) throw new Error("카메라를 켜거나 사진을 가져와 주세요.");
      await appendImage(captureFrame());
    });
  const captureRef = useRef(capture);
  captureRef.current = capture;
  useEffect(() => {
    if (!live || view !== "camera") return;
    let cancelled = false,
      detecting = false,
      stable = 0,
      previous: Quad | null = null;
    const timer = window.setInterval(async () => {
      if (detecting || busyRef.current || !videoRef.current?.videoWidth) return;
      detecting = true;
      try {
        const source = captureFrame();
        const found = await detectDocument(source);
        if (cancelled) return;
        setQuad(found);
        const image = await loadImage(source);
        const canvas = overlayRef.current;
        if (canvas) {
          canvas.width = canvas.clientWidth;
          canvas.height = canvas.clientHeight;
          const ctx = canvas.getContext("2d")!;
          const scale = Math.min(
            canvas.width / image.width,
            canvas.height / image.height,
          );
          const ox = (canvas.width - image.width * scale) / 2,
            oy = (canvas.height - image.height * scale) / 2;
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          if (found) {
            ctx.strokeStyle = "#2581f6";
            ctx.lineWidth = 3;
            ctx.beginPath();
            found.forEach((p, i) =>
              i === 0
                ? ctx.moveTo(ox + p.x * scale, oy + p.y * scale)
                : ctx.lineTo(ox + p.x * scale, oy + p.y * scale),
            );
            ctx.closePath();
            ctx.stroke();
          }
        }
        const movement =
          found && previous
            ? Math.max(
                ...found.map((p, i) =>
                  Math.hypot(p.x - previous![i].x, p.y - previous![i].y),
                ),
              ) / Math.max(image.width, image.height)
            : 1;
        stable = found && movement < 0.015 ? stable + 1 : 0;
        previous = found;
        if (auto && stable >= 3) {
          stable = 0;
          void captureRef.current();
        }
      } catch {
        if (!cancelled) setQuad(null);
      } finally {
        detecting = false;
      }
    }, 900);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [live, view, auto]);

  const importFiles = (files: FileList | null) => {
    if (!files?.length) return;
    const chosen = Array.from(files);
    void run("사진 가져오는 중", async () => {
      const count = chosen.length * (mode === "책" ? 2 : 1);
      if (pages.length + count > 20)
        throw new Error("문서당 20페이지를 초과했어요.");
      // Decode the entire batch before committing to avoid partial imports.
      const added: ScanPage[] = [];
      for (const file of chosen) {
        const source = await importImage(file);
        added.push(...(await preparePages(source, mode === "책")).pages);
      }
      setPages((previous) => [...previous, ...added]);
      setActive(pages.length);
      navigate("review");
    });
  };
  const updatePage = (page: ScanPage) =>
    setPages((previous) =>
      previous.map((item) => (item.id === page.id ? page : item)),
    );
  const applyFilter = (filter: ImageFilter) =>
    selected &&
    run("필터 적용 중", async () => {
      updatePage({
        ...selected,
        image: await processImage(selected.original, undefined, filter),
        filter,
        ocr: undefined,
      });
    });
  const recognizePages = async () => {
    const recognized: ScanPage[] = [];
    for (let i = 0; i < pages.length; i++) {
      const page = pages[i];
      const ocr =
        page.ocr ??
        (await recognizeText(page.image, (value) =>
          setProgress(Math.round(((i + value) / pages.length) * 100)),
        ));
      recognized.push({ ...page, ocr });
    }
    setPages(recognized);
    return recognized;
  };
  const extractText = () =>
    run("한국어 · 영어 OCR 실행 중", async () => {
      await recognizePages();
      openSheet("ocr");
    });
  const exportPdf = (searchable: boolean) =>
    run(searchable ? "OCR 및 PDF 생성 중" : "PDF 생성 중", async () => {
      const ready = searchable ? await recognizePages() : pages;
      const { createScanPdf } = await import("./scanner/pdf");
      const blob = await createScanPdf(ready, { searchable, quality });
      downloadBlob(blob, title.trim() || "Quiet Scan");
      setNotice("PDF 파일을 생성했어요. 다운로드 목록을 확인하세요.");
      setSheet(null);
    });
  const save = () =>
    run("기기에 저장 중", async () => {
      const doc: ScanDocument = {
        ...newDocument(pages, title),
        ...(documentId ? { id: documentId, createdAt } : {}),
        title: title.trim() || "제목 없는 문서",
        tags: tags
          .split(",")
          .map((tag) => tag.trim())
          .filter(Boolean),
      };
      await saveDocument(doc);
      setDocumentId(doc.id);
      setCreatedAt(doc.createdAt);
      setNotice("이 브라우저에 문서를 저장했어요.");
      setSheet(null);
    });
  const openCrop = () =>
    selected &&
    run("자르기 준비 중", async () => {
      const image = await loadImage(selected.original);
      setCropSize({ width: image.width, height: image.height });
      setCropQuad(
        (await detectDocument(selected.original)) ?? [
          { x: 0, y: 0 },
          { x: image.width - 1, y: 0 },
          { x: image.width - 1, y: image.height - 1 },
          { x: 0, y: image.height - 1 },
        ],
      );
      openSheet("crop");
    });
  const openCleanup = () =>
    selected &&
    run("책 보정 분석 중", async () => {
      const source = selected.cleanupOriginal ?? selected.original;
      const { analyzeBookPage } = await import("./scanner/book-enhancement");
      const [analysis, image, filtered] = await Promise.all([
        analyzeBookPage(source),
        loadImage(source),
        processImage(source, undefined, selected.filter),
      ]);
      setCleanupDraft({
        source,
        image: filtered,
        width: image.width,
        height: image.height,
        ...analysis,
      });
      openSheet("cleanup");
    });
  const previewCleanup = async (
    options: CleanupOptions,
  ): Promise<CleanupPreview | { error: string }> => {
    let result: CleanupPreview | undefined;
    let error = "보정할 페이지가 없어요.";
    await run("책 보정 미리보기 생성 중", async () => {
      if (!cleanupDraft || !selected) return;
      try {
        const { enhanceBookPage } = await import("./scanner/book-enhancement");
        const original = await enhanceBookPage(cleanupDraft.source, options);
        result = {
          original,
          image: await processImage(original, undefined, selected.filter),
        };
      } catch (cause) {
        error = errorMessage(cause);
        throw cause;
      }
    });
    return result ?? { error };
  };
  const applyCleanup = (preview: CleanupPreview) => {
    if (!selected || !cleanupDraft || busyRef.current) return;
    updatePage({
      ...selected,
      ...preview,
      cleanupOriginal: cleanupDraft.source,
      ocr: undefined,
    });
    setSheet(null);
    setCleanupDraft(null);
    setNotice(
      "책 보정을 적용했어요. OCR은 다시 실행하세요. ‘책 보정 되돌리기’로 원본을 복원할 수 있어요.",
    );
  };
  const undoCleanup = () =>
    selected?.cleanupOriginal &&
    run("책 보정 되돌리는 중", async () => {
      const original = selected.cleanupOriginal!;
      updatePage({
        ...selected,
        original,
        image: await processImage(original, undefined, selected.filter),
        cleanupOriginal: undefined,
        ocr: undefined,
      });
      setNotice("책 보정 전 이미지로 되돌렸어요. OCR은 다시 실행하세요.");
    });
  const text = pages
    .map((page, i) => `[페이지 ${i + 1}]\n${page.ocr?.text ?? ""}`)
    .join("\n\n");
  const reset = () => {
    stopCamera();
    setPages([]);
    setActive(0);
    setDocumentId(null);
    setTitle("");
    setTags("");
    navigate("camera");
  };

  return (
    <>
      <input
        ref={fileRef}
        data-testid="image-import"
        type="file"
        accept="image/jpeg,image/png,image/webp"
        multiple
        hidden
        onChange={(event) => {
          importFiles(event.target.files);
          event.target.value = "";
        }}
      />
      {view === "camera" ? (
        <main
          className="app-screen camera-screen"
          aria-label="문서 스캔 카메라"
        >
          {live ? (
            <video
              ref={videoRef}
              className="camera-feed live-camera"
              muted
              playsInline
            />
          ) : (
            <img
              className="camera-feed"
              src={SAMPLE}
              alt="카메라 연결 전 샘플 배경"
              draggable="false"
            />
          )}
          <div className="camera-shade" />
          <canvas
            ref={overlayRef}
            className="live-overlay"
            aria-hidden="true"
          />
          <header className="camera-toolbar">
            <button
              className="icon-button"
              aria-label="내 문서"
              onClick={() => navigate("library")}
            >
              <FileTextIcon />
            </button>
            <div className="toolbar-actions">
              <button
                className={flash ? "icon-button active" : "icon-button"}
                aria-label="플래시"
                aria-pressed={flash}
                disabled={!live}
                onClick={() =>
                  void run("플래시 설정 중", async () => {
                    const track = streamRef.current?.getVideoTracks()[0];
                    if (!track) return;
                    if (
                      !(
                        track.getCapabilities() as MediaTrackCapabilities & {
                          torch?: boolean;
                        }
                      ).torch
                    )
                      throw new Error("이 카메라는 플래시를 지원하지 않아요.");
                    await track.applyConstraints({
                      advanced: [{ torch: !flash } as MediaTrackConstraintSet],
                    });
                    setFlash(!flash);
                  })
                }
              >
                <LightningBoltIcon />
              </button>
              <button
                className="icon-button"
                aria-label="설정"
                onClick={() => openSheet("settings")}
              >
                <GearIcon />
              </button>
            </div>
          </header>
          <section className="capture-message">
            <h1>문서를 스캔하세요</h1>
            <p>
              {live
                ? quad
                  ? "문서 경계를 찾았어요"
                  : "문서를 화면 가운데 놓으세요"
                : "카메라를 켜거나 사진을 가져오세요"}
            </p>
            {!live && (
              <>
                <button
                  className="camera-start"
                  onClick={() => void startCamera()}
                >
                  <CameraIcon /> 카메라 켜기
                </button>
                <button
                  className="sample-start"
                  onClick={() =>
                    void run("샘플 보정 중", () => appendImage(SAMPLE))
                  }
                >
                  샘플로 체험하기
                </button>
              </>
            )}
          </section>
          <section className="capture-controls">
            <div className="mode-switch" aria-label="스캔 모드">
              {MODES.map((item) => (
                <button
                  key={item}
                  className={mode === item ? "selected" : ""}
                  aria-pressed={mode === item}
                  disabled={!!busy}
                  onClick={() => setMode(item)}
                >
                  {item}
                </button>
              ))}
            </div>
            <div className="shutter-row">
              <button
                className="side-control"
                disabled={!!busy}
                onClick={() => fileRef.current?.click()}
              >
                <span>
                  <ImageIcon />
                </span>
                가져오기
              </button>
              <button
                className="shutter"
                aria-label="촬영"
                disabled={!live || !!busy || pages.length >= 20}
                onClick={() => void capture()}
              >
                <span />
              </button>
              <button
                className="side-control"
                aria-pressed={auto}
                disabled={!live}
                onClick={() => setAuto(!auto)}
              >
                <span>
                  <CameraIcon />
                </span>
                {auto ? "자동 촬영 켜짐" : "자동 촬영"}
              </button>
            </div>
            {pages.length > 0 && (
              <button
                className="sample-start"
                onClick={() => navigate("review")}
              >
                {pages.length}페이지 미리보기
              </button>
            )}
          </section>
        </main>
      ) : view === "library" ? (
        <div className="review-shell">
          <header className="review-header">
            <button
              className="icon-button light"
              aria-label="카메라로 돌아가기"
              onClick={() => navigate("camera")}
            >
              <ArrowLeftIcon />
            </button>
            <h1>내 문서</h1>
            <button className="text-button" onClick={reset}>
              <PlusIcon /> 새 스캔
            </button>
          </header>
          <div className="library-search">
            <MagnifyingGlassIcon />
            <KeyboardInput
              aria-label="문서 검색"
              placeholder="제목 · 본문 · 태그 검색"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <MobileScroll className="review-screen">
            <main className="review-content">
              <p className="privacy-note">
                이 브라우저에만 저장됩니다 · {documents.length}개
              </p>
              {documents.length === 0 && (
                <p className="empty-documents">
                  저장된 문서가 없어요.
                  <br />
                  스캔 후 ‘문서 저장’을 눌러 주세요.
                </p>
              )}
              {documents.map((doc) => (
                <article className="document-row" key={doc.id}>
                  <button
                    className="document-open"
                    onClick={() => {
                      setPages(doc.pages);
                      setActive(0);
                      setTitle(doc.title);
                      setTags(doc.tags.join(", "));
                      setDocumentId(doc.id);
                      setCreatedAt(doc.createdAt);
                      navigate("review");
                    }}
                  >
                    <img src={doc.pages[0].image} alt="" />
                    <span>
                      <strong>{doc.title}</strong>
                      <small>
                        {doc.pages.length}페이지 ·{" "}
                        {new Date(doc.updatedAt).toLocaleDateString("ko-KR")}
                      </small>
                      <small>{doc.tags.join(" · ")}</small>
                    </span>
                  </button>
                  <button
                    className="icon-button light"
                    aria-label={`${doc.title} 삭제`}
                    onClick={() => {
                      setDeleteId(doc.id);
                      openSheet("delete");
                    }}
                  >
                    <TrashIcon />
                  </button>
                </article>
              ))}
            </main>
          </MobileScroll>
        </div>
      ) : (
        <div className="review-shell">
          <header className="review-header">
            <button
              className="icon-button light"
              aria-label="촬영 화면으로 돌아가기"
              onClick={() => navigate("camera")}
            >
              <ArrowLeftIcon />
            </button>
            <div>
              <span className="eyebrow">{pages.length}페이지</span>
              <h1>스캔 미리보기</h1>
            </div>
            <button className="text-button" onClick={() => openSheet("save")}>
              문서 저장
            </button>
          </header>
          <MobileScroll className="review-screen">
            <main className="review-content">
              {selected && (
                <>
                  <section className="document-preview actual-preview">
                    <img
                      src={selected.image}
                      alt={`${active + 1}페이지 스캔`}
                      draggable="false"
                    />
                    <div className="quality-badge">
                      <CheckCircledIcon /> {active + 1}페이지
                    </div>
                  </section>
                  <div className="page-tools">
                    <button onClick={() => void openCrop()} disabled={!!busy}>
                      자르기
                    </button>
                    <button
                      aria-label="페이지 회전"
                      disabled={!!busy}
                      onClick={() =>
                        void run("회전 중", async () => {
                          const original = await rotateImage(selected.original);
                          updatePage({
                            ...selected,
                            original,
                            image: await processImage(
                              original,
                              undefined,
                              selected.filter,
                            ),
                            ocr: undefined,
                            cleanupOriginal: undefined,
                          });
                        })
                      }
                    >
                      <RotateClockwiseIcon /> 회전
                    </button>
                    <button
                      aria-label="페이지 삭제"
                      disabled={!!busy}
                      onClick={() => {
                        setPages(pages.filter((p) => p.id !== selected.id));
                        setActive(Math.max(0, active - 1));
                        if (pages.length === 1) navigate("camera");
                      }}
                    >
                      <TrashIcon /> 삭제
                    </button>
                  </div>
                  <div className="page-tools cleanup-entry">
                    <button
                      disabled={!!busy}
                      onClick={() => void openCleanup()}
                    >
                      <MagicWandIcon /> 책 보정
                    </button>
                    {selected.cleanupOriginal && (
                      <button
                        disabled={!!busy}
                        onClick={() => void undoCleanup()}
                      >
                        책 보정 되돌리기
                      </button>
                    )}
                  </div>
                  <section className="filter-section">
                    <div className="section-heading">
                      <h2>필터 선택</h2>
                      <span className="privacy-note">기기에서 처리</span>
                    </div>
                    <Carousel ariaLabel="필터" contentClassName="filter-rail">
                      {FILTERS.map((item) => (
                        <button
                          key={item.id}
                          className={
                            selected.filter === item.id
                              ? "filter-chip selected"
                              : "filter-chip"
                          }
                          aria-pressed={selected.filter === item.id}
                          disabled={!!busy}
                          onClick={() => void applyFilter(item.id)}
                        >
                          <span className="filter-swatch">
                            <MagicWandIcon />
                          </span>
                          {item.label}
                        </button>
                      ))}
                    </Carousel>
                  </section>
                </>
              )}
              <section className="pages-section">
                <div className="section-heading">
                  <h2>페이지</h2>
                  <button
                    className="add-page"
                    disabled={pages.length >= 20}
                    onClick={() => navigate("camera")}
                  >
                    <PlusIcon /> 추가 촬영
                  </button>
                </div>
                <Carousel ariaLabel="스캔 페이지" contentClassName="page-strip">
                  {pages.map((page, i) => (
                    <button
                      key={page.id}
                      className={
                        active === i ? "page-thumb active" : "page-thumb"
                      }
                      aria-label={`${i + 1}페이지`}
                      aria-pressed={active === i}
                      onClick={() => setActive(i)}
                    >
                      <img src={page.image} alt="" />
                      <span>{i + 1}</span>
                    </button>
                  ))}
                </Carousel>
                <div className="page-tools">
                  <button
                    disabled={active === 0 || !!busy}
                    onClick={() => {
                      const next = [...pages];
                      [next[active - 1], next[active]] = [
                        next[active],
                        next[active - 1],
                      ];
                      setPages(next);
                      setActive(active - 1);
                    }}
                  >
                    앞으로 이동
                  </button>
                  <button
                    disabled={active >= pages.length - 1 || !!busy}
                    onClick={() => {
                      const next = [...pages];
                      [next[active + 1], next[active]] = [
                        next[active],
                        next[active + 1],
                      ];
                      setPages(next);
                      setActive(active + 1);
                    }}
                  >
                    뒤로 이동
                  </button>
                </div>
              </section>
              <div className="review-actions">
                <button
                  className="secondary-action"
                  disabled={!!busy || !pages.length}
                  onClick={() => void extractText()}
                >
                  <ReaderIcon /> 텍스트 추출
                </button>
                <button
                  className="primary-action"
                  disabled={!!busy || !pages.length}
                  onClick={() => openSheet("export")}
                >
                  <DownloadIcon /> PDF 저장
                </button>
              </div>
              <button
                className="sheet-primary"
                onClick={() => navigate("library")}
              >
                내 문서 보기
              </button>
            </main>
          </MobileScroll>
        </div>
      )}
      {notice && (
        <div
          className={view === "camera" ? "camera-notice" : "global-notice"}
          role="status"
        >
          {notice}
          <button aria-label="알림 닫기" onClick={() => setNotice("")}>
            <Cross2Icon />
          </button>
        </div>
      )}
      {busy && (
        <div className="processing-overlay app-busy" role="status">
          <div className="processing-card">
            <span className="spinner" />
            <strong>{busy}</strong>
            {progress > 0 && <small>{progress}%</small>}
            <small>문서는 서버로 전송하지 않습니다</small>
          </div>
        </div>
      )}
      <BottomSheet
        open={sheet === "settings"}
        onOpenChange={closeSheet}
        title="Quiet Scan"
        description="로컬 문서 스캐너"
      >
        <p>
          촬영, 보정, 한국어·영어 OCR과 PDF 생성을 이 브라우저에서 처리해요.
          사진은 서버로 보내지 않습니다.
        </p>
        <p>
          책 모드는 중앙에서 좌우 페이지를 나눠요. ‘책 보정’에서 실험적 곡률
          보정과 선택한 손가락 영역 가리기를 이용할 수 있어요. 가려진 글자는
          복원하지 않습니다. 클라우드 전송은 하지 않아요.
        </p>
        <button
          className="sheet-primary"
          onClick={() => {
            setSheet(null);
            stopCamera();
          }}
        >
          카메라 끄기
        </button>
      </BottomSheet>
      <BottomSheet
        open={sheet === "ocr"}
        onOpenChange={closeSheet}
        title="추출된 텍스트"
        description="OCR 결과는 오인식이 있을 수 있어요. 원문과 확인하세요."
      >
        <div className="ocr-panel">
          <p className="ocr-result">
            {text.trim() || "인식된 텍스트가 없어요."}
          </p>
          <button
            className="sheet-primary"
            onClick={() =>
              void run("복사 중", async () => {
                await navigator.clipboard.writeText(text);
                setSheet(null);
                setNotice("텍스트를 복사했어요.");
              })
            }
          >
            텍스트 복사
          </button>
          <button
            className="secondary-action full-width"
            onClick={() => downloadText(text, title || "Quiet Scan")}
          >
            TXT 다운로드
          </button>
        </div>
      </BottomSheet>
      <BottomSheet
        open={sheet === "export"}
        onOpenChange={closeSheet}
        title="내보내기"
        description="이미지 PDF 또는 OCR 텍스트가 포함된 PDF를 생성합니다."
      >
        <div className="page-tools">
          <button
            aria-pressed={quality === "high"}
            onClick={() => setQuality("high")}
          >
            고화질
          </button>
          <button
            aria-pressed={quality === "compact"}
            onClick={() => setQuality("compact")}
          >
            용량 줄이기
          </button>
        </div>
        <button
          className="sheet-primary"
          disabled={!!busy}
          onClick={() => void exportPdf(false)}
        >
          이미지 PDF 다운로드
        </button>
        <button
          className="sheet-primary"
          disabled={!!busy}
          onClick={() => void exportPdf(true)}
        >
          검색 가능한 PDF 다운로드
        </button>
        <button
          className="secondary-action full-width"
          disabled={!selected}
          onClick={() =>
            void run("이미지 생성 중", async () =>
              downloadBlob(
                await (await fetch(selected.image)).blob(),
                (title || "스캔") + ".jpg",
              ),
            )
          }
        >
          현재 페이지 JPG 다운로드
        </button>
      </BottomSheet>
      <BottomSheet
        open={sheet === "save"}
        onOpenChange={closeSheet}
        title="문서 저장"
        description="이 브라우저의 저장소에 보관합니다. 중요한 문서는 PDF로도 백업하세요."
      >
        <label className="editor-label">
          문서 제목
          <KeyboardInput
            aria-label="문서 제목"
            maxLength={160}
            value={title}
            placeholder="제목 없는 문서"
            onChange={(e) => setTitle(e.target.value)}
          />
        </label>
        <label className="editor-label">
          태그
          <KeyboardInput
            aria-label="태그"
            value={tags}
            maxLength={490}
            placeholder="업무, 공부 (쉼표로 구분)"
            onChange={(e) => setTags(e.target.value)}
          />
        </label>
        <button
          className="sheet-primary"
          disabled={!!busy}
          onClick={() => void save()}
        >
          기기에 저장
        </button>
      </BottomSheet>
      <BottomSheet
        open={sheet === "delete"}
        onOpenChange={closeSheet}
        title="문서를 삭제할까요?"
        description="저장된 이미지와 OCR 텍스트를 이 브라우저에서 삭제합니다."
      >
        <button
          className="sheet-primary danger-action"
          onClick={() =>
            void run("삭제 중", async () => {
              if (deleteId) await deleteDocument(deleteId);
              setDocuments(await listDocuments(query));
              setDeleteId(null);
              setSheet(null);
            })
          }
        >
          문서 삭제
        </button>
        <button
          className="secondary-action full-width"
          onClick={() => setSheet(null)}
        >
          취소
        </button>
      </BottomSheet>
      <BottomSheet
        open={sheet === "cleanup"}
        onOpenChange={closeSheet}
        title="로컬 책 보정"
        description="곡률을 조정하고 선택한 영역만 종이색으로 가립니다. 분석은 제안이며 자동으로 적용하지 않습니다."
        snap={0.84}
      >
        {sheet === "cleanup" && selected && cleanupDraft && (
          <BookCleanupPanel
            key={selected.id}
            draft={cleanupDraft}
            busy={!!busy}
            onPreview={previewCleanup}
            onApply={applyCleanup}
          />
        )}
      </BottomSheet>
      <BottomSheet
        open={sheet === "crop"}
        onOpenChange={closeSheet}
        title="문서 모서리 조정"
        description="왼쪽 위부터 시계 방향으로 모서리를 조정하세요."
      >
        {selected && cropQuad && (
          <>
            <div className="crop-image">
              <img
                className="crop-preview"
                src={selected.original}
                alt="자르기 원본"
              />
              <svg
                className="crop-outline"
                viewBox={`0 0 ${cropSize.width} ${cropSize.height}`}
                aria-hidden="true"
              >
                <polygon
                  points={cropQuad.map((p) => `${p.x},${p.y}`).join(" ")}
                  fill="#2581f61a"
                  stroke="#2581f6"
                  strokeWidth="3"
                  vectorEffect="non-scaling-stroke"
                />
                {cropQuad.map((point, i) => (
                  <circle
                    key={i}
                    cx={point.x}
                    cy={point.y}
                    r={Math.max(cropSize.width, cropSize.height) * 0.018}
                    fill="#2581f6"
                  />
                ))}
              </svg>
            </div>
            <div className="crop-controls">
              {cropQuad.map((point, i) => (
                <fieldset key={i}>
                  <legend>
                    {["왼쪽 위", "오른쪽 위", "오른쪽 아래", "왼쪽 아래"][i]}
                  </legend>
                  {(["x", "y"] as const).map((axis) => (
                    <label key={axis}>
                      {axis.toUpperCase()}
                      <input
                        type="range"
                        data-scroll-drag="ignore"
                        aria-label={`${i + 1}번 모서리 ${axis}`}
                        min={0}
                        max={
                          axis === "x"
                            ? cropSize.width - 1
                            : cropSize.height - 1
                        }
                        value={point[axis]}
                        onChange={(event) =>
                          setCropQuad(
                            cropQuad.map((p, j) =>
                              j === i
                                ? { ...p, [axis]: Number(event.target.value) }
                                : p,
                            ) as Quad,
                          )
                        }
                      />
                    </label>
                  ))}
                </fieldset>
              ))}
            </div>
            <button
              className="sheet-primary"
              onClick={() =>
                void run("원근 보정 중", async () => {
                  const original = await processImage(
                    selected.original,
                    cropQuad,
                    "original",
                  );
                  updatePage({
                    ...selected,
                    original,
                    image: await processImage(
                      original,
                      undefined,
                      selected.filter,
                    ),
                    ocr: undefined,
                    cleanupOriginal: undefined,
                  });
                  setSheet(null);
                })
              }
            >
              원근 보정 적용
            </button>
          </>
        )}
      </BottomSheet>
    </>
  );
}
