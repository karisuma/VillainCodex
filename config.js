// 환경 설정
// 개발/배포 모드를 쉽게 전환하기 위한 설정 파일

// 현재 환경 모드 (DEV 또는 PRODUCT)
const MODE = 'PRODUCT'; // <- 여기만 변경하면 됨!

const CONFIG = {
  DEV: {
    API_URL: 'http://localhost:8787',
    MODE_NAME: '개발 모드 (로컬)'
  },
  PRODUCT: {
    API_URL: 'https://cors-anywhere.herokuapp.com/http://121.125.73.16:8787',
    MODE_NAME: '배포 모드 (서버)'
  }
};

// 현재 설정
export const API = CONFIG[MODE].API_URL;
export const MODE_NAME = CONFIG[MODE].MODE_NAME;
export const IS_DEVELOPMENT = MODE === 'DEV';
export const IS_PRODUCTION = MODE === 'PRODUCT';

// 콘솔에 현재 모드 출력
console.log(`🔧 ${MODE_NAME} - API: ${API}`);