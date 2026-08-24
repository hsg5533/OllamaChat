import RNBlobUtil from 'react-native-blob-util';

export const label = 'Gemma 4 E2B';

const name = 'gemma-4-E2B-it-qat-UD-Q4_K_XL.gguf';

/** 앱 내부 저장소. 실제로 추론에 쓰는 경로. */
const path = `${RNBlobUtil.fs.dirs.DocumentDir}/${name}`;

async function isUsable(path: string) {
  if (!(await RNBlobUtil.fs.exists(path))) return false;
  const stat = await RNBlobUtil.fs.stat(path);
  return Number(stat.size) > 2_620_370_976 * 0.95;
}

/**
 * 추론에 쓸 모델 파일 경로를 보장한다.
 * llama.cpp 는 APK 안의 asset 을 직접 열 수 없어서 최초 1회만 내부 저장소로 복사한다(수십 초).
 */
export async function prepare() {
  if (await isUsable(path)) return path;

  const tmp = `${path}.part`;
  (await RNBlobUtil.fs.exists(tmp)) && (await RNBlobUtil.fs.unlink(tmp));

  await RNBlobUtil.fs.cp(RNBlobUtil.fs.asset(name), tmp);

  (await RNBlobUtil.fs.exists(path)) && (await RNBlobUtil.fs.unlink(path));
  await RNBlobUtil.fs.mv(tmp, path);
  return path;
}
