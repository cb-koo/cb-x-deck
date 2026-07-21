'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { driver, type Driver } from 'driver.js';
import 'driver.js/dist/driver.css';
import type { TourStep } from './tourSteps';
import { markTourSeen } from './tourState';

function toDriverSteps(steps: TourStep[]) {
  return steps.map((s) => ({
    element: s.element,
    popover: {
      title: s.title,
      description: s.description,
      side: s.side,
      align: s.align,
    },
  }));
}

export function useTour() {
  const driverRef = useRef<Driver | null>(null);
  const stepsRef = useRef<TourStep[]>([]);
  const [activeTour, setActiveTour] = useState<string | null>(null);

  const start = useCallback((tourId: string, steps: TourStep[]) => {
    driverRef.current?.destroy();
    stepsRef.current = steps;
    const d = driver({
      showProgress: true,
      nextBtnText: '다음',
      prevBtnText: '이전',
      doneBtnText: '완료',
      progressText: '{{current}} / {{total}}',
      steps: toDriverSteps(steps),
      // 완료·건너뛰기·바깥클릭 어느 경로든 종료 시 '본 것'으로 저장
      onDestroyed: () => {
        markTourSeen(tourId);
        setActiveTour(null);
        driverRef.current = null;
      },
    });
    driverRef.current = d;
    setActiveTour(tourId);
    d.drive();
  }, []);

  // 투어 활성 중 호스트 컴포넌트가 언마운트되면(예: 투어 도중 사이드바 링크로 이동)
  // driver.js가 document.body에 붙인 오버레이가 남아 클릭을 막을 수 있어 정리한다.
  useEffect(() => () => { driverRef.current?.destroy(); }, []);

  // 현재 활성 스텝 id가 fromId일 때만 다음으로 진행 — 행동 유도형 자동 전진
  const advance = useCallback((fromId: string) => {
    const d = driverRef.current;
    if (!d || !d.isActive()) return;
    const idx = d.getActiveIndex();
    if (idx == null) return;
    if (stepsRef.current[idx]?.id === fromId) d.moveNext();
  }, []);

  return { start, advance, activeTour };
}
