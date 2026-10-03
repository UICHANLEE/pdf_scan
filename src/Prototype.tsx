import { useEffect, useReducer, useState } from "react";
import {
  ArrowLeftIcon,
  CameraIcon,
  CheckCircledIcon,
  ChevronRightIcon,
  Cross2Icon,
  DownloadIcon,
  FileTextIcon,
  GearIcon,
  ImageIcon,
  LightningBoltIcon,
  MagicWandIcon,
  PlusIcon,
  ReaderIcon,
} from "@radix-ui/react-icons";
import { BottomSheet, Carousel, MobileScroll } from "./mobile";

type CaptureMode = "자동" | "책" | "문서";
type Screen = "camera" | "processing" | "review";
type Filter = "자동" | "원본" | "문서" | "흑백";
type Sheet = "gallery" | "export" | "ocr" | "settings" | null;
const CAPTURE_MODES: CaptureMode[] = ["자동", "책", "문서"];
const FILTERS: Filter[] = ["자동", "원본", "문서", "흑백"];
const MAX_PAGES = 20;
const CAMERA_ASSET = "/assets/app/book-camera-preview.png";
type ScanState = { screen: Screen; pageCount: number; activePage: number };
type ScanAction =
  | { type: "capture" }
  | { type: "processed"; pages: number }
  | { type: "camera" }
  | { type: "select"; page: number }
  | { type: "reset" };
const initialScan: ScanState = {
  screen: "camera",
  pageCount: 0,
  activePage: 0,
};
function scanReducer(state: ScanState, action: ScanAction): ScanState {
  switch (action.type) {
    case "capture":
      return state.screen === "camera" && state.pageCount < MAX_PAGES
        ? { ...state, screen: "processing" }
        : state;
    case "processed":
      return state.screen === "processing"
        ? {
            ...state,
            screen: "review",
            pageCount: Math.min(MAX_PAGES, state.pageCount + action.pages),
            activePage: state.pageCount,
          }
        : state;
    case "camera":
      return { ...state, screen: "camera" };
    case "select":
      return action.page >= 0 && action.page < state.pageCount
        ? { ...state, activePage: action.page }
        : state;
    case "reset":
      return initialScan;
  }
}

function FilterPicker({
  value,
  onChange,
}: {
  value: Filter;
  onChange: (filter: Filter) => void;
}) {
  return (
    <div className="filter-list">
      {FILTERS.map((item) => (
        <button
          key={item}
          aria-pressed={value === item}
          className={value === item ? "filter-chip selected" : "filter-chip"}
          onClick={() => onChange(item)}
        >
          <span className={`filter-swatch swatch-${item}`}>
            <MagicWandIcon />
          </span>
          {item}
        </button>
      ))}
    </div>
  );
}

const OCR_TEXT = `작은 순간이 큰 변화를 만든다.\n\n좋은 하루는 아주 작은 마음에서 시작된다. 거창한 계획이 아니어도 괜찮다. 오늘을 조금 더 단정하게 살아보려는 마음, 그 하나로 충분하다.`;

export default function Prototype() {
  const [mode, setMode] = useState<CaptureMode>("책");
  const [{ screen, pageCount, activePage }, dispatch] = useReducer(
    scanReducer,
    initialScan,
  );
  const [flash, setFlash] = useState(false);
  const [filter, setFilter] = useState<Filter>("자동");
  const [sheet, setSheet] = useState<Sheet>(null);
  const [notice, setNotice] = useState("");
  const [autoCapture, setAutoCapture] = useState(false);
  const closeSheet = (open: boolean) => {
    if (!open) setSheet(null);
  };

  useEffect(() => {
    if (screen !== "processing") return;
    const timer = window.setTimeout(
      () => dispatch({ type: "processed", pages: mode === "책" ? 2 : 1 }),
      1100,
    );
    return () => window.clearTimeout(timer);
  }, [screen, mode]);

  const startCapture = () => {
    setNotice("");
    dispatch({ type: "capture" });
  };
  const copySample = async () => {
    try {
      await navigator.clipboard.writeText(OCR_TEXT);
      setNotice("샘플 텍스트를 복사했어요");
      setSheet(null);
    } catch {
      setNotice("복사 권한이 없어요. 텍스트를 직접 선택해 복사하세요.");
    }
  };

  if (screen === "review") {
    return (
      <>
        <div className="review-shell">
          <header className="review-header">
            <button
              className="icon-button light"
              aria-label="촬영 화면으로 돌아가기"
              onClick={() => dispatch({ type: "camera" })}
            >
              <ArrowLeftIcon />
            </button>
            <div>
              <span className="eyebrow">{pageCount}페이지</span>
              <h1>스캔 미리보기</h1>
            </div>
            <button className="text-button" onClick={() => setSheet("export")}>
              완료
            </button>
          </header>
          <MobileScroll className="app-screen review-screen">
            <main className="review-content" aria-label="스캔 미리보기">
              <section
                className={`document-preview filter-${filter}`}
                aria-label="보정된 문서"
              >
                <img
                  src={CAMERA_ASSET}
                  alt={`${activePage + 1}페이지 샘플 스캔`}
                  draggable="false"
                />
                <div className="page-divider" aria-hidden="true" />
                <div className="quality-badge">
                  <CheckCircledIcon /> 샘플 미리보기 · {activePage + 1}페이지
                </div>
              </section>

              <section className="filter-section" aria-label="이미지 필터">
                <div className="section-heading">
                  <div>
                    <span className="eyebrow">이미지 보정</span>
                    <h2>필터 선택</h2>
                  </div>
                  <span className="privacy-note">이미지 필터 데모</span>
                </div>
                <FilterPicker value={filter} onChange={setFilter} />
              </section>

              <section className="pages-section">
                <div className="section-heading compact">
                  <h2>페이지</h2>
                  <button
                    className="add-page"
                    disabled={pageCount >= MAX_PAGES}
                    onClick={() => dispatch({ type: "camera" })}
                  >
                    <PlusIcon /> 추가 촬영
                  </button>
                </div>
                <Carousel ariaLabel="스캔 페이지" contentClassName="page-strip">
                  {Array.from({ length: pageCount }, (_, index) => (
                    <button
                      className={
                        index === activePage
                          ? "page-thumb active"
                          : "page-thumb"
                      }
                      key={index}
                      aria-label={`${index + 1}페이지`}
                      aria-pressed={index === activePage}
                      onClick={() => dispatch({ type: "select", page: index })}
                    >
                      <img src={CAMERA_ASSET} alt="" draggable="false" />
                      <span>{index + 1}</span>
                    </button>
                  ))}
                  <button
                    className="page-add-tile"
                    disabled={pageCount >= MAX_PAGES}
                    onClick={() => dispatch({ type: "camera" })}
                  >
                    <PlusIcon />
                    <span>페이지</span>
                  </button>
                </Carousel>
              </section>

              <div className="review-actions">
                <button
                  className="secondary-action"
                  onClick={() => setSheet("ocr")}
                >
                  <ReaderIcon /> OCR 데모
                </button>
                <button
                  className="primary-action"
                  onClick={() => setSheet("export")}
                >
                  <DownloadIcon /> PDF 안내
                </button>
              </div>

              {notice && (
                <p className="operation-notice" role="status">
                  {notice}
                </p>
              )}
            </main>
          </MobileScroll>
        </div>

        <BottomSheet
          open={sheet === "ocr"}
          onOpenChange={closeSheet}
          title="OCR 데모"
          description="아래는 고정 샘플입니다. 실제 문자 인식은 아직 연결되지 않았어요."
        >
          <div className="ocr-panel">
            <div className="ocr-confidence">
              <ReaderIcon /> 샘플 텍스트
            </div>
            <p>{OCR_TEXT}</p>
            {notice && <p role="status">{notice}</p>}
            <button className="sheet-primary" onClick={copySample}>
              텍스트 복사
            </button>
          </div>
        </BottomSheet>

        <BottomSheet
          open={sheet === "export"}
          onOpenChange={closeSheet}
          title="PDF 내보내기 안내"
          description="이 버전은 화면 데모입니다. PDF 생성과 저장은 아직 연결되지 않았어요."
        >
          <div className="export-list">
            <button disabled>
              <span className="export-icon">
                <FileTextIcon />
              </span>
              <span>
                <strong>검색 가능한 PDF</strong>
                <small>OCR 엔진과 PDF 생성 연동 예정</small>
              </span>
              <ChevronRightIcon />
            </button>
            <button disabled>
              <span className="export-icon">
                <ImageIcon />
              </span>
              <span>
                <strong>이미지 PDF</strong>
                <small>파일 내보내기 연동 예정</small>
              </span>
              <ChevronRightIcon />
            </button>
          </div>
        </BottomSheet>
      </>
    );
  }

  return (
    <>
      <main className="app-screen camera-screen" aria-label="문서 스캔 카메라">
        <img
          className="camera-feed"
          src={CAMERA_ASSET}
          alt="책상 위 펼친 책 카메라 데모"
          draggable="false"
        />
        <div className="camera-shade" />

        <header className="camera-toolbar">
          <button
            className="icon-button"
            aria-label="스캔 데모 초기화"
            onClick={() => {
              dispatch({ type: "reset" });
              setFilter("자동");
              setFlash(false);
              setAutoCapture(false);
              setMode("책");
            }}
          >
            <Cross2Icon />
          </button>
          <div className="toolbar-actions">
            <button
              className={flash ? "icon-button active" : "icon-button"}
              aria-label="플래시"
              aria-pressed={flash}
              onClick={() => setFlash((value) => !value)}
            >
              <LightningBoltIcon />
            </button>
            <button
              className="icon-button"
              aria-label="설정"
              onClick={() => setSheet("settings")}
            >
              <GearIcon />
            </button>
          </div>
        </header>

        <section className="capture-message">
          <h1>문서를 스캔하세요</h1>
          <span className="demo-label">카메라 데모 · 샘플 이미지</span>
          <p>
            {mode === "책"
              ? "두 페이지를 자동으로 나눠 보정해요"
              : "자동으로 테두리를 인식하고 보정합니다"}
          </p>
        </section>

        <div
          className={`detection-frame mode-${mode}`}
          aria-label="문서 영역 감지됨"
        >
          <span className="corner top-left" />
          <span className="corner top-right" />
          <span className="corner bottom-left" />
          <span className="corner bottom-right" />
          {mode === "책" && <span className="book-split" />}
          <div className="detection-label">
            <CheckCircledIcon /> {mode === "책" ? "책 감지됨" : "문서 감지됨"}
          </div>
        </div>

        <section className="capture-controls">
          <div className="mode-switch" aria-label="스캔 모드">
            {CAPTURE_MODES.map((item) => (
              <button
                key={item}
                aria-pressed={mode === item}
                disabled={screen === "processing"}
                className={mode === item ? "selected" : ""}
                onClick={() => setMode(item)}
              >
                {item}
              </button>
            ))}
          </div>

          <div className="shutter-row">
            <button
              className="side-control"
              onClick={() => setSheet("gallery")}
            >
              <span>
                <ImageIcon />
              </span>
              가져오기
            </button>
            <button
              className="shutter"
              aria-label="촬영"
              disabled={screen === "processing" || pageCount >= MAX_PAGES}
              onClick={startCapture}
            >
              <span />
            </button>
            <button
              className="side-control"
              aria-pressed={autoCapture}
              onClick={() => setAutoCapture((value) => !value)}
            >
              <span>
                <CameraIcon />
              </span>
              {autoCapture ? "자동 촬영 켜짐" : "자동 촬영"}
            </button>
          </div>
        </section>

        {screen === "processing" && (
          <div className="processing-overlay" role="status">
            <div className="processing-card">
              <span className="spinner" />
              <strong>샘플 미리보기를 준비해요</strong>
              <small>자동 보정 흐름을 보여주는 데모입니다</small>
            </div>
          </div>
        )}
      </main>

      <BottomSheet
        open={sheet === "settings"}
        onOpenChange={closeSheet}
        title="프로토타입 안내"
        description="Quiet Scan · 로컬 화면 데모"
      >
        <p>
          실제 카메라, 문서 감지, 보정, OCR, PDF 생성은 연결 전입니다. 모든
          사진과 텍스트는 샘플이며 서버로 전송하지 않습니다.
        </p>
        <p>
          플래시와 자동 촬영은 설정 상태만 시뮬레이션합니다. 한 세션에서 최대{" "}
          {MAX_PAGES}페이지를 미리볼 수 있어요.
        </p>
      </BottomSheet>
      <BottomSheet
        open={sheet === "gallery"}
        onOpenChange={closeSheet}
        title="샘플 사진 가져오기"
        description="실제 기기 갤러리에 접근하지 않는 데모입니다."
      >
        <div className="gallery-grid">
          {[0, 1, 2].map((item) => (
            <button
              key={item}
              onClick={() => {
                setSheet(null);
                startCapture();
              }}
            >
              <img
                src={CAMERA_ASSET}
                alt={`${item + 1}번째 샘플 문서`}
                draggable="false"
              />
              <span>
                <CheckCircledIcon />
              </span>
            </button>
          ))}
        </div>
      </BottomSheet>
    </>
  );
}
