export type ScanPage = {
  id: string;
  image: string;
  original: string;
  /** Single unfiltered baseline for undoing book cleanup; included in the byte cap. */
  cleanupOriginal?: string;
  filter: "original" | "auto" | "document" | "bw" | "gray" | "photo";
  ocr?: {
    text: string;
    confidence: number;
    lines: Array<{
      text: string;
      confidence: number;
      bbox: { x0: number; y0: number; x1: number; y1: number };
    }>;
  };
};

export type ScanDocument = {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  tags: string[];
  pages: ScanPage[];
};

const DATABASE_NAME = "quiet-capture-scans";
const DATABASE_VERSION = 1;
const DOCUMENT_STORE = "documents";
const MAX_IMAGE_BYTES = 100 * 1024 * 1024;
const MAX_OCR_CHARACTERS = 250_000;
const DATA_URL_PATTERN =
  /^data:image\/(?:jpeg|png);base64,([A-Za-z0-9+/]*={0,2})$/i;

let databasePromise: Promise<IDBDatabase> | undefined;

function storageError(message: string, cause?: unknown): Error {
  const error = new Error(message);
  error.name = "ScanStorageError";
  if (cause !== undefined) {
    (error as Error & { cause?: unknown }).cause = cause;
  }
  return error;
}

function openDatabase(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") {
    return Promise.reject(
      storageError("이 브라우저에서는 로컬 문서 저장을 사용할 수 없습니다."),
    );
  }

  if (!databasePromise) {
    databasePromise = new Promise<IDBDatabase>((resolve, reject) => {
      let request: IDBOpenDBRequest;
      let blocked = false;
      try {
        request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
      } catch (error) {
        reject(storageError("로컬 문서 저장소를 열지 못했습니다.", error));
        return;
      }

      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(DOCUMENT_STORE)) {
          database.createObjectStore(DOCUMENT_STORE, { keyPath: "id" });
        }
      };
      request.onsuccess = () => {
        const database = request.result;
        if (blocked) {
          database.close();
          return;
        }
        database.onversionchange = () => {
          database.close();
          databasePromise = undefined;
        };
        resolve(database);
      };
      request.onerror = () =>
        reject(
          storageError("로컬 문서 저장소를 열지 못했습니다.", request.error),
        );
      request.onblocked = () => {
        blocked = true;
        reject(
          storageError(
            "다른 탭이 저장소를 사용 중입니다. 해당 탭을 닫고 다시 시도해 주세요.",
          ),
        );
      };
    }).catch((error: unknown) => {
      // Allow a later retry if opening failed or was blocked.
      databasePromise = undefined;
      throw error;
    });
  }

  return databasePromise;
}

function transaction<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore, setResult: (value: T) => void) => void,
): Promise<T> {
  return openDatabase().then(
    (database) =>
      new Promise<T>((resolve, reject) => {
        let tx: IDBTransaction | undefined;
        let result: T | undefined;
        let hasResult = false;

        try {
          tx = database.transaction(DOCUMENT_STORE, mode);
          const store = tx.objectStore(DOCUMENT_STORE);
          run(store, (value) => {
            result = value;
            hasResult = true;
          });
        } catch (error) {
          try {
            tx?.abort();
          } catch {
            /* The transaction may already be inactive. */
          }
          reject(storageError("문서 저장소를 처리하지 못했습니다.", error));
          return;
        }

        tx.oncomplete = () => {
          if (hasResult) resolve(result as T);
          else reject(storageError("저장 작업이 완료되지 않았습니다."));
        };
        tx.onerror = () =>
          reject(
            storageError("문서 저장소에서 오류가 발생했습니다.", tx.error),
          );
        tx.onabort = () =>
          reject(storageError("저장 작업이 취소되었습니다.", tx.error));
      }),
  );
}

function base64ByteLength(value: string): number {
  if (
    typeof value !== "string" ||
    value.length > Math.ceil((MAX_IMAGE_BYTES * 4) / 3) + 32
  )
    throw storageError("페이지 이미지 용량이 너무 큽니다.");
  const match = DATA_URL_PATTERN.exec(value);
  if (!match) {
    throw storageError(
      "페이지 이미지는 JPEG 또는 PNG 형식의 base64 데이터여야 합니다.",
    );
  }

  const data = match[1];
  if (
    data.length % 4 !== 0 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
      data,
    )
  ) {
    throw storageError("페이지 이미지 데이터가 올바르지 않습니다.");
  }

  const padding = data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0;
  return (data.length / 4) * 3 - padding;
}

function validateDocument(document: ScanDocument): void {
  if (!document || typeof document !== "object") {
    throw storageError("저장할 문서 정보가 올바르지 않습니다.");
  }
  if (typeof document.id !== "string" || document.id.trim().length === 0) {
    throw storageError("문서 식별 정보가 올바르지 않습니다.");
  }
  if (typeof document.title !== "string" || document.title.length > 160) {
    throw storageError("문서 제목은 160자 이내로 입력해 주세요.");
  }
  if (
    !Number.isFinite(document.createdAt) ||
    !Number.isFinite(document.updatedAt)
  ) {
    throw storageError("문서 날짜 정보가 올바르지 않습니다.");
  }
  if (
    !Array.isArray(document.tags) ||
    document.tags.length > 12 ||
    document.tags.some((tag) => typeof tag !== "string" || tag.length > 40)
  ) {
    throw storageError("태그는 최대 12개까지, 각각 40자 이내로 입력해 주세요.");
  }
  if (
    !Array.isArray(document.pages) ||
    document.pages.length < 1 ||
    document.pages.length > 20
  ) {
    throw storageError("문서는 1~20페이지로 저장할 수 있습니다.");
  }

  let imageBytes = 0;
  let ocrCharacters = 0;
  for (const page of document.pages) {
    if (!page || typeof page.id !== "string" || page.id.trim().length === 0) {
      throw storageError("페이지 식별 정보가 올바르지 않습니다.");
    }
    if (
      !["original", "auto", "document", "bw", "gray", "photo"].includes(
        page.filter,
      )
    ) {
      throw storageError("페이지 보정 정보가 올바르지 않습니다.");
    }
    imageBytes +=
      base64ByteLength(page.image) + base64ByteLength(page.original);
    if (page.cleanupOriginal !== undefined)
      imageBytes += base64ByteLength(page.cleanupOriginal);
    if (imageBytes > MAX_IMAGE_BYTES) {
      throw storageError(
        "문서 이미지가 너무 큽니다. 한 문서의 이미지 용량은 100MB 이하여야 합니다.",
      );
    }
    if (page.ocr !== undefined) {
      if (
        typeof page.ocr.text !== "string" ||
        !Array.isArray(page.ocr.lines) ||
        !Number.isFinite(page.ocr.confidence) ||
        page.ocr.confidence < 0 ||
        page.ocr.confidence > 1
      ) {
        throw storageError("OCR 텍스트 정보가 올바르지 않습니다.");
      }
      ocrCharacters += page.ocr.text.length;
      for (const line of page.ocr.lines) {
        if (
          typeof line.text !== "string" ||
          !Number.isFinite(line.confidence) ||
          line.confidence < 0 ||
          line.confidence > 1 ||
          !line.bbox ||
          ![line.bbox.x0, line.bbox.y0, line.bbox.x1, line.bbox.y1].every(
            Number.isFinite,
          )
        ) {
          throw storageError("OCR 줄 정보가 올바르지 않습니다.");
        }
        ocrCharacters += line.text.length;
      }
      if (ocrCharacters > MAX_OCR_CHARACTERS) {
        throw storageError("문서의 OCR 텍스트가 너무 큽니다.");
      }
    }
  }
}

export async function saveDocument(document: ScanDocument): Promise<void> {
  validateDocument(document);
  await transaction<void>("readwrite", (store, setResult) => {
    store.put(document);
    setResult(undefined);
  });
}

export async function listDocuments(query?: string): Promise<ScanDocument[]> {
  const documents = await transaction<ScanDocument[]>(
    "readonly",
    (store, setResult) => {
      const request = store.getAll();
      request.onsuccess = () => setResult(request.result as ScanDocument[]);
    },
  );
  const terms = (query ?? "")
    .toLocaleLowerCase()
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  return documents
    .filter((document) => {
      if (terms.length === 0) return true;
      const body = [
        document.title,
        ...document.tags,
        ...document.pages.flatMap((page) => [
          page.ocr?.text ?? "",
          ...(page.ocr?.lines.map((line) => line.text) ?? []),
        ]),
      ]
        .join(" ")
        .toLocaleLowerCase();
      return terms.every((term) => body.includes(term));
    })
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function deleteDocument(id: string): Promise<void> {
  await transaction<void>("readwrite", (store, setResult) => {
    store.delete(id);
    setResult(undefined);
  });
}

export async function getDocument(
  id: string,
): Promise<ScanDocument | undefined> {
  return transaction<ScanDocument | undefined>(
    "readonly",
    (store, setResult) => {
      const request = store.get(id);
      request.onsuccess = () =>
        setResult(request.result as ScanDocument | undefined);
    },
  );
}

function createId(): string {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export function newDocument(
  pages: ScanPage[],
  title = "스캔 문서",
): ScanDocument {
  const now = Date.now();
  return {
    id: createId(),
    title,
    createdAt: now,
    updatedAt: now,
    tags: [],
    pages,
  };
}
