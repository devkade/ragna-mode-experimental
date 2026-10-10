# Ragna Gateway: re0 memo

상태: 아키텍처 전환 및 스캐폴딩 진행 중 — 현재 코드에는 OMO를 기본 실행 명령으로 둔 기존 구조가 남아 있지만, 목표는 Pi Gateway와 `pi-durable` Harness를 중심으로 하는 구조다. 이 전환은 아직 진행 중이며, 현재 스캐폴딩을 출발점으로 유지한다. 패키지/모듈 진입점을 먼저 세우고, 이후 각 기능은 테스트·모듈 단위가 아니라 실제 표면을 관통하는 E2E 수직 슬라이스로 구현한다. 단일 Gateway 프로세스 가정은 아직 배포에서 검증되지 않았다.

## 목적

`kdl-ragna`는 여러 입력 표면에서 온 요청을 처리하고, 더 큰 작업은 Herdr lane에 위임하며, 요청의 처음부터 끝까지 상태와 증거를 추적하는 Gateway를 만들기 위한 출발점이다. 현재 실행 표면은 Pi extension이 아니라 CLI process로 둔다. Ragna는 기존 Dori 코드의 포크가 아니다. Dori의 인터뷰 문서는 아이디어와 도메인 사례로만 참고한다.

현재 목표는 구현을 서두르지 않고, 다중 agent 환경에서 유지되는 도메인 계약과 실행 구조를 세우는 것이다. 현재 스캐폴딩은 OMO 실행 명령 등 기존 구조를 포함하지만, 이를 목표 구조로 간주하지 않는다. Ragna의 Gateway 역할은 Pi Gateway가 맡고, 대화 및 요청 trace의 정본은 `pi-durable` Harness가 맡도록 전환 중이다. OMO는 필요하면 Herdr lane 안에서 실행할 후보 agent 중 하나일 뿐, Gateway나 trace 저장소가 아니다. 사용자는 Pi뿐 아니라 Codex, Claude, OMP, OMO, GJC 등 서로 다른 agent를 사용할 수 있으므로, 설계는 특정 agent의 세션 형식이나 CLI 기능을 공통 기반으로 가정하지 않아야 한다.

## 현재 합의된 방향

- Discord와의 입출력에는 `agent-messenger`를 사용한다. Discord 연결·메시지 수신/전송은 이 역할이며, Pi Durable Gateway의 요청 추적 SSOT와 구분한다.
- 서버 메시지는 허용 채널과 허용 사용자 목록을 모두 통과해야 처리한다. DM은 채널 허용 목록과 무관하게 허용 사용자에게 허용하며, 응답 모드와 무관하게 허용 사용자의 모든 DM을 처리한다. 서버 채널은 기본적으로 모든 메시지를 처리하고, 멘션/봇 답글 전용 모드로 설정할 수 있다.
- Discord thread마다 Pi Durable conversation 하나를 연결한다. 같은 thread의 후속 메시지는 그 conversation의 맥락으로 이어간다.
- 각 Discord 메시지는 별도의 request로 추적한다. Thread 안 메시지는 해당 thread의 Pi Durable conversation에 연결하고, thread 밖 채널 메시지는 메시지별 새 conversation에 연결한다. DM은 사용자별 conversation 하나를 공유한다.
- 같은 Pi Durable conversation에 짧은 시간 내 연속 request가 들어오면 수집 후 하나의 chunk로 제출하고 최대 대기 시간도 둔다. 구체 시간값은 초기 실험에서 정한다. 각 Discord 메시지는 개별 request ID로 추적하고 chunk 처리 결과를 원본 request들과 연결한다.
- Herdr lane이 바쁠 때 일반 후속 지시는 도착 순서대로 큐에 둔다. 명시적 중단·방향 변경은 우선 전달하되, 전달 시도와 실제 중단/수용 확인을 구분한다.
- Lane 보고와 진행 상태는 Gateway 모니터링 경로로 관측한다. Dori의 현재 운영 구조를 우선 참고해 lane이 일정 시간 조용하면 한 번 진행을 묻고, 더 오래 조용하면 마지막 보고를 소유자에게 전달한다. 멈춘 pane은 감지해 알리며, 작업이 끝나지 않았다면 소유자가 같은 세션을 재시작하는 흐름을 따른다. Dori 구현의 기본 nudge/보고 기준은 각각 15분/20분이며 각 침묵 구간에 한 번 동작한다. Ragna에서도 우선 이 구조를 따르되 간격은 초기 실험으로 조정한다. Lane이 소유자 결정을 요청하면 Gateway가 질문을 소유자에게 전달하고 답을 lane에 되돌린다. 결정에 의존하는 작업의 대기와 정체 감지는 구분하며, 무관한 작업은 계속 진행한다. Dori 구현에서 결정별 대기/재개를 자동 관리하는 기능은 확인되지 않았다.
- 동일 Discord message ID의 중복 이벤트는 동일 request로 처리해야 한다. 첫 단계에서는 Dori처럼 보존 inbox 기준으로 중복을 억제하고 미완료 batch를 복구한다. 동시 쓰기와 전송-기록 사이 crash까지 포괄하는 exactly-once 보장은 후속 단계에서 검증·강화한다.
- Gateway는 간단한 요청을 직접 처리해 빠르게 답한다.
- 별도 작업이 필요한 요청은 Herdr에 lane을 띄워 처리한다. Gateway가 작업 시작 전에 검증 가능한 완료 조건을 정해 lane에 전달하고, 조건의 존재와 문법을 시작 전에 검사한다. Gateway가 조건을 만들 수 있으면 소유자 승인 없이 작업을 시작할 수 있다. 조건을 만들기 어렵거나 검증 불가능하면 작업을 시작하지 않고 소유자에게 조건을 마련하거나 범위를 조정해 달라고 요청한 뒤 답을 기다린다. lane이 조건을 제안해 Gateway가 승인하는 방식은 채택하지 않는다. Gateway는 lane 진행을 모니터링하고, 조용한 lane에는 Dori식으로 한 번 진행을 묻고 더 오래 조용하면 마지막 보고를 소유자에게 전달한다. 멈춘 pane은 감지해 알리며, 미완료 작업은 소유자가 같은 세션을 재시작하는 흐름을 우선 참고한다. Dori의 15분/20분 기준은 Ragna 초기 실험의 출발값이지 고정값이 아니다. 완료 조건 검증에 실패하면 Gateway는 실패 이유를 lane에 전달해 계속 작업하게 하고, 수정 후 다시 완료를 주장하도록 요청한다. 모든 조건이 통과해야 검증 완료로 본다. 조건의 의미적 품질을 자동 판정하지 않는 한계도 일단 수용한다.
- 복합 요청은 즉시 답할 수 있는 부분과 위임할 부분으로 나눌 수 있다.
- 진행 상황, 질문, 완료 주장, 실제 검증 및 사용자에게 전달된 결과는 서로 구분해 추적해야 한다. 일반 milestone은 가까운 보고를 묶어 새 메시지로 보내고, blocker·question·done claim은 각각 즉시 보낸다. 보고 batch 간격은 초기 실험에서 정한다.
- 최종 결과 Discord 전달은 최초 전송 뒤 최대 3회 추가 재시도한다(최대 4회 시도). 모두 실패하면 자동 재시도를 멈추고 요청을 미종결·운영자 조치 필요 상태로 둔다. 재시도 간격은 미정이다.
- 실패 후 자동 재실행은 기본적으로 하지 않는다. 확인된 실패 영역과 실행 여부를 보고하고, 중복 부작용이 없음을 확인할 수 있는 경우에만 재시도한다.
- Herdr lane에서 기본 지원으로 인정하려면 실행, 고유 작업 식별, 종료 결과 관측이 가능해야 한다. 입력 전달·중단·재개는 agent별 capability로 표시하고 실제 공통 시나리오로 검증한다.
- 하나의 Discord 메시지에 대한 전체 처리 흐름을 추적하되, Pi Gateway turn, Herdr 작업, Discord 전달은 서로 다른 하위 실행/효과로 구분한다. 실패 알림은 해당 하위 흐름과 원인 영역(Gateway, agent, Herdr, Discord/agent-messenger 또는 기타 연동)을 표시한다. 원인을 판별할 증거가 부족하면 추측하지 않고 `unknown/unclassified`로 기록한다.
- 요청 추적은 핵심 요구다. 명령을 보냈다는 사실만으로 응답·lane 생성·완료가 성공했다고 간주하지 않는다.
- 목표 구조에서 Ragna는 CLI process로 실행되고, 그 프로세스가 Pi Gateway 역할을 `pi-durable` Harness 위에서 수행한다. `pi-durable`은 대화와 요청 trace의 정본이다. Pi extension 진입점은 현재 스캐폴딩 방향에 포함하지 않는다. 이 목표 구조로 옮기는 과정은 진행 중이며, 현재 스캐폴딩에 남은 OMO 기본 명령과 기존 lane 중심 기능은 마이그레이션 완료를 뜻하지 않는다.
- Gateway의 대화와 요청 추적의 SSOT는 `pi-durable`로 둔다. Discord 요청, Pi 실행, Herdr lane, 보고·검증·회신을 연결한 정본 기록을 별도 Ragna 상태 저장소에 중복 소유하지 않는다. 외부 시스템의 실제 상태는 `pi-durable` 기록에 관측 사실과 참조로 반영한다.
- Gateway는 일반 Pi CLI/RPC보다 `pi-durable` Harness 기반으로 만든다. 목표는 요청 추적·복구와 운영 안정성을 높이는 것이다. OAuth 인증·재시작 복구·외부 효과의 보장 범위는 단계별 실험으로 확인한다.
- Codex, Claude, OMP, OMO, GJC 등 사용 대상 agent는 Herdr lane 안에서 실행한다. 각 agent의 실제 기능과 호환 수준은 따로 검증한다.
- 전체를 한 번에 구현하지 않는다. 작은 단계를 순서대로 시험하고, 동작과 안정성 근거를 확인한 뒤 다음으로 진행한다.
- 간단한 요청과 lane 위임 요청을 나누는 규칙은 현재 단계에서 결정하지 않고 후속 단계로 미룬다.

## 도메인 이야기

이 흐름은 현재 설계 가설이다. 요청 분류 기준과 응답 정책은 아직 합의하지 않았다.

1. Discord 메시지가 도착하면 원본 서버·채널·메시지 참조를 보존해 요청을 식별한다.
2. Gateway는 직접 답변, lane 위임, 또는 둘의 혼합으로 요청을 처리한다. 직접 답할 수 있는 부분은 lane 완료를 기다리지 않는다.
3. 위임 시 Gateway는 작업 의도와 원본 요청을 연결하고 Herdr lane을 만든다. 생성 요청, 실제 lane 확인, agent 세션 연결은 별개의 관측 사실이다.
4. Lane은 진행·막힘·질문·완료 주장을 Gateway 모니터링 경로에 보고한다. 모니터링 경로가 끊기면 Gateway는 이를 복구하고 영향을 받은 lane의 상태를 확인할 때까지 해당 작업을 완료로 처리하지 않는다. Gateway는 소유자 결정이 필요한 질문이나 blocker를 소유자에게 전달하고, 소유자 답변을 받으면 해당 lane에 다시 전달한다. 결정에 의존하는 작업만 답을 기다리며 무관한 일은 계속 진행해야 한다. 이 결정 대기와, 결정에 의존하지 않는 미완료 작업을 남긴 채 lane 진행이 멈춘 상태를 구분하며, 후자에는 Gateway가 계속 진행하도록 후속 지시를 보낸다.
5. 완료 주장은 완료가 아니다. 검증 가능한 조건을 확인하고, 작업 검증과 최종 결과 전달을 별도 상태로 기록한다. 작업 검증이 통과해도 Discord 전달이 실패했다면 작업은 검증 완료지만 요청은 결과 전달이 확인될 때까지 미종결이다.
6. 중단·재시작 뒤에는 미확정 외부 효과를 조정한다. 결과가 불분명하면 성공으로 추정하거나 중복 실행하지 않고 확인 필요 상태를 유지한다.

## 추적 모델 원칙

`pi-durable`의 정본 상태에서 작업 요청을 상관관계의 중심으로 둔다. 하나의 요청에서 파생된 대화 실행, dispatch, lane, 보고, 결정, 검증, Discord 응답은 안정된 ID와 명시적 관계로 연결한다. 별도 Ragna 저장소에 같은 요청 상태를 중복 소유하지 않는다. 각 상태는 현재 요약과 함께 발생 순서가 보존된 이벤트/증거를 가져야 한다.

최소한 다음을 구분한다:

- **의도**: 무엇을 하려고 하는가.
- **명령/시도**: 외부 시스템에 어떤 동작을 요청했는가.
- **관측/확인**: Discord, Pi 또는 Herdr에서 실제 무엇을 읽어 확인했는가.
- **전달**: 플랫폼이 메시지를 수락하고 식별자를 돌려줬는가, 또는 수신자의 응답·명시적 확인 같은 상관된 증거가 있는가. Discord 전송 성공은 사람이 읽었다는 증거가 아니다.
- **완료**: 작업 기준 검증, 사용자 결과 전달, 자원 정리를 각각 구분한다. 작업은 검증 완료될 수 있지만, 결과 전달이 확인되지 않은 요청은 미종결이다.

따라서 `sent`, `started`, `done` 같은 상태명은 정의 없이 성공을 뜻해서는 안 된다. 외부 효과는 pending/attempted/confirmed 또는 equivalent한 구분을 가져야 하고, 재시작 후 재시도 전 기존 효과를 조회·조정한다. 전달 확인은 플랫폼 API 수락, 수신자의 명시적 확인 등 관측 가능한 증거로 정의하며, 사람의 열람을 확인할 수 없는 경우 그 한계를 그대로 기록한다.

## Agent 호환성 방향

기본 지원은 Herdr lane 실행, 고유 작업 식별, 종료 결과 관측이 가능할 때 인정한다. 입력 전달·중단·재개는 agent별 capability로 따로 표시하고 실제 공통 시나리오로 검증한다.

공통화할 대상은 agent의 내부 기능이 아니라 Ragna가 필요로 하는 **작업 수명주기 계약**이다. 후보 계약은 실행 요청, 작업 식별, 상태 관측, 입력/중단 전달, 결과·종료 관측, 재연결 가능성이다. 각 기능은 구현 여부와 증거 수준을 capability로 표현하고, 없는 기능을 흉내 내거나 가장 낮은 공통분모로 축소하지 않는다.

Codex, Claude, OMP, OMO, GJC 등은 Herdr lane 안에서 실행할 agent 후보이지, 지원 약속이나 우선순위가 아니다. 지원 여부는 실제 CLI/API와 세션 복구 동작을 확인하고, 같은 계약 기반 시나리오를 실행한 뒤에만 선언한다. Herdr는 lane 실행 환경을 맡고, 각 agent의 실행·상태 관측·재개 능력은 별도로 검증한다.

## Dori에서 참고할 동작과 구현상 주의점

Dori의 의도된 운영 규칙은 owner 메시지를 요청으로 취급하고, 원본 대화에서 빠르게 답하거나 lane 작업을 알리며, 응답이 원본 메시지/대화에 연결됐는지 확인하는 것이다. 완료 보고는 claim으로 두고 실제 완료 조건을 따로 검증한다. Ragna는 이 도메인 교훈을 새 구조로 재설계하며 Dori 코드나 문서를 복사하지 않는다.

현재 Dori Discord listener의 실제 필터는 설정 가능한 allowlist가 아니라 특정 owner ID와 특정 guild/channel ID의 하드코딩 조합이다. 허용 owner의 DM은 guild/channel 검사 없이 통과하며, 멘션이나 봇 답글 여부는 필수 조건이 아니다. Inbox는 channel 단위로 batch하고 Discord thread parent를 대화 식별자로 풀지 않는다. 따라서 Ragna의 허용 채널·사용자 설정, 선택 가능한 mention/reply 응답 모드, thread별 conversation 계약은 Dori 구현이 이미 제공한다고 가정하지 말고 별도로 설계·검증한다.

중복 처리에서 Dori의 `Inbox.add`는 보존된 inbox 항목의 Discord message ID와 일치하면 새 항목 추가를 거부한다. 시작 시 reply marker가 없는 dispatch batch를 복구 대상으로 다시 내보내고, reply 경로는 최근 100개 채널 메시지에서 원본을 참조하는 bot 답글을 찾아 중복 전송을 피하려 한다. 테스트는 같은 ID 거부와 reload 복구를 확인한다. 그러나 dedupe는 inbox 파일에 남아 있는 동안의 검사이며 원자적 uniqueness 보장이 아니다. 동시 프로세스 쓰기, inbox 유실, 응답 전송과 marker 저장 사이의 crash window에서 end-to-end exactly-once 처리는 보장되지 않는다. Ragna는 이 동작을 참고하되, 중복 이벤트 처리와 복구 강도는 별도 계약·검증 대상으로 둔다.

## Dori에서 가져올 원칙, Ragna에 맞게 재설계

Dori는 동작 원칙과 실패 사례를 참고하는 도메인 선례이지, Ragna의 구조나 구현 기반이 아니다. 특히 Dori의 lane registry, Herdr pane 명령, OMO 세션 추론, 파일 기반 inbox를 Ragna의 SSOT나 agent 공통 인터페이스로 복사하지 않는다.

Ragna 형태에 맞춰 보존할 원칙:

- 원본 Discord 메시지, 개별 request ID, Pi Durable conversation, Herdr lane, 선택 agent, 보고와 회신을 추적 가능한 관계로 연결한다.
- 오래 걸리는 작업은 원본 대화에 먼저 접수 사실을 알린다. 진행 보고는 출처와 시각을 붙이고, lane의 주장과 검증된 사실을 분리한다.
- 완료는 worker의 완료 주장으로 확정하지 않는다. 요청에 맞는 검증 근거를 확인하고, 사용자에게 최종 결과가 전달된 사실도 별도로 기록한다. Dori는 호출자가 lane 시작 전에 완료 조건을 주고, launch/adopt 때 구문을 검사하며, 완료 주장 뒤 live 조건을 재검증한다. 다만 조건이 실제 목표를 검증하는지 의미 품질은 자동 판단하지 않는다. Ragna에서도 Gateway가 조건을 준비하며, 검증 조건을 만들기 어렵거나 검증할 수 없으면 소유자에게 조건 마련 또는 범위 조정을 요청하고, 답변 이후에도 검증 가능한 조건이 마련되어야 진행한다. 검증 실패나 evidence 부재 시 Gateway는 lane에 보완을 요청하고 조건 통과까지 재검증과 보완을 반복한다.
- agent나 외부 시스템에 동작을 요청한 것, 대상이 실제로 수락·실행한 것, 결과를 관측한 것을 각각 다른 상태/증거로 남긴다.
- 재시작 후 저장된 의도만 재생하지 않고 Discord·Herdr의 실제 상태를 대조해 미확정 외부 효과를 조정한다.
- 사용자 결정이 필요한 부분은 명시적 대기 상태로 두고, 결정과 무관한 작업은 계속할 수 있게 한다. 구체적인 결정 큐/우선순위 규칙은 아직 미정이다.

Dori의 실제 구현은 이 원칙을 모두 보장하지 않는다. pane 입력 전송 확인은 agent가 입력을 수락하거나 처리했다는 증거가 아니며, freshness relay는 pane에서 읽은 마지막 보고를 재전달할 뿐 보고의 진실성이나 새 메시지의 readback을 보장하지 않는다. lane cleanup 실패도 종료 기록과 분리되지 않는 경로가 있다. inbox message-ID 중복 억제는 보존된 상태에 한정되고, 동시 쓰기 및 전송-기록 사이 crash에서 exactly-once를 보장하지 않는다. Ragna는 이 구현 한계와 가정을 그대로 상속하지 않고, 실제 관측 가능한 계약으로 다시 정의한다.

## 완료 조건

초기 Ragna 동작은 Dori의 완료 조건 흐름을 참고한다. Gateway는 Herdr 작업을 시작하기 전에 검증 가능한 완료 조건을 정해 lane에 전달하고, 조건이 존재하며 문법상 해석 가능한지 시작 전에 확인한다. Gateway가 조건을 만들 수 있으면 소유자 승인 없이 진행한다. 조건을 만들기 어렵거나 기계적으로 검증할 수 없으면 lane을 시작하지 않는다. Gateway는 소유자에게 완료 조건을 마련하거나 작업 범위를 조정해 달라고 요청하고, 답을 받은 뒤에도 검증 가능한 완료 조건이 마련된 경우에만 진행한다. lane이 조건을 제안해 Gateway가 승인하는 절차는 두지 않는다.

Lane은 질문·막힘·진행·완료 주장을 Gateway 모니터링 경로에 보고한다. 모니터링 경로가 끊기면 Gateway는 이를 복구하고 영향을 받은 lane의 상태를 확인할 때까지 해당 작업을 완료로 처리하지 않는다. 우선 Dori의 현재 운영 구조를 따른다. lane이 일정 시간 조용하면 Gateway가 한 번 진행을 묻고, 더 오래 조용하면 마지막 보고를 소유자에게 전달한다. 멈춘 pane은 감지해 알리고, 작업이 끝나지 않았다면 소유자가 같은 세션을 재시작한다. Dori의 기본 nudge/owner 보고 기준은 각각 15분/20분이며 각 침묵 구간에 한 번 동작한다. Ragna에서는 이 기준을 초기 실험의 출발값으로 삼아 조정한다. 소유자 결정이 필요한 질문이나 blocker는 Gateway가 소유자에게 전달하고, 소유자 답변을 해당 lane에 전달한다. 결정에 의존하는 작업의 대기는 정체 감지와 구분하며, 무관한 작업은 계속 진행한다. Dori 구현에는 결정별 대기/재개 자동화가 확인되지 않았다.

lane의 완료 주장은 사실이 아니라 검증 요청이다. 주장 후 관측 가능한 evidence로 조건을 다시 평가한다. 조건이 실패하거나 확인 불가능하면 Gateway는 실패 이유를 lane에 전달해 작업을 계속하고, 수정 후 다시 완료를 주장하도록 요청한다. 모든 조건이 통과해야 작업을 검증 완료로 본다. Dori 구현에서는 수정 요청의 반복 횟수나 실패 시 추가 에스컬레이션은 확인되지 않았으므로 Ragna의 세부 대응은 미정이다. 작업 검증과 Discord 결과 전달은 별도 상태다.

완료 조건의 문법 검증과 의미적 품질 검토는 구별한다. 초기에는 조건의 의미적 적절성을 자동 판정하지 않는다. 조건이 약하거나 형식적으로만 통과할 수 있다는 한계를 알고 채택한다.

## pi-durable 선택과 검증 범위

`pi-durable` Harness를 Gateway 기반으로 쓰는 쪽을 선호하기로 했다. Owner는 SQLite 대신 JSONL을 사용해도 된다고 승인했다. pi-durable의 내장 JSON-backed 선택지인 `openNodeJsonlStorage`와 `{ fsync: true }`를 사용한다. JSONL은 append-only이며 저장소 하나는 한 프로세스가 소유해야 한다. 교차 프로세스 잠금은 제공되지 않으므로 Phase 1은 단일 Gateway 프로세스라는 운영 가정에 의존하고, 실제 배포 보장은 별도 확인한다. 공식 README는 이를 대화·모델 실행·도구 호출·사용자 상태를 저장하고 재시작 후 이어갈 수 있는 harness로 설명하지만 experimental이며 API가 바뀔 수 있다고 명시한다.

이 선택이 Discord 전달이나 Herdr lane의 실제 상태까지 자동으로 보장한다는 뜻은 아니다. 그 외부 효과의 시도·관측 증거도 `pi-durable`의 정본 상태에 기록하고 상관관계 ID로 연결해야 한다. OAuth credential 경로, durable storage의 복구 의미, Herdr 작업과의 연결 및 재시작 시 중복 부작용 방지는 작은 검증을 통해 확인한다. 검증 결과가 요구 안정성을 충족하지 않으면 설계를 재검토한다.

2026-10-10 JSONL 실험: `@earendil-works/pi-durable@1.1.0` + faux provider로 JSONL을 열고 root conversation을 저장한 뒤 별도 프로세스에서 다시 열었을 때 동일 root ID를 확인했다. 더 강하게, submit 직후 프로세스를 정상 close 없이 종료한 뒤 재실행해 같은 `requestId`의 submission을 찾아 `resume()`하고 최종 상태 `done`을 관측했다. 저장소 옵션은 `{ fsync: true }`였다. 이는 pi-durable의 harness task 및 append-only storage 복구에 대한 증거이며, 실제 LLM provider의 in-flight 호출 재실행 의미, OAuth credential 복구, 외부 효과의 중복 방지는 검증하지 않았다. JSONL은 단일 프로세스가 소유해야 하고 cross-process lock이 없다. JSONL 라인 구조와 fsync 옵션은 패키지 README에 근거한다. 2026-10-10 Herdr live probe: 현재 세션에서 별도 pane을 만들고 임시 `sleep`/`bash read` 명령을 실행했다. `pane process-info`로 실행 PID와 명령을 관측했고, `send-text`+Enter로 입력을 전달해 `GOT:decision:continue` 출력을 확인했으며, `C-c` 후 foreground process group이 shell로 돌아오는 것도 확인했다. 다만 그 pane은 `agent_status: unknown`이고 `herdr agent list`에서 보이지 않았다. 따라서 pane 명령 제어는 증명됐지만 인식된 agent 시작·고유 session identity·완료 상태·재시작 후 같은 세션 확인은 증명되지 않았다. 임시 pane은 닫았다. Generic pane control을 agent lane lifecycle과 동일시하지 않는다. 이후 Herdr `0.9.3` 실험에서 전용 pane에 pi를 시작하고 무해한 exact-response 작업을 제출해 `working` → `done` 관측, Herdr가 보고한 pi session 경로 확인, pane 종료 후 새 pane에서 같은 `--session` 경로로 다시 시작해 기존 transcript/token 확인까지 했다. 이는 명시적 native session path를 알고 있을 때 same-session 재연결이 가능하다는 증거다. Herdr 서버 재시작 후 자동 lane 발견/복구나 Ragna 쪽 자동 재개는 증명하지 않았다.

JSONL 동시 소유 검사에서는 같은 디렉터리를 첫 writer가 연 동안 두 번째 `openNodeJsonlStorage`도 성공했다. 즉 라이브러리는 단일 writer 원칙을 강제하지 않는다. 추가로 `proper-lockfile@4.1.2`의 OS-visible lock probe를 했다. writer A가 lock을 쥔 동안 별도 Node 프로세스 B는 `ELOCKED`로 거절됐고, A가 lock을 해제한 뒤 B가 획득했다. 이는 후보 guard의 증거일 뿐, Ragna 의존성/구현으로 채택된 것은 아니다. 현재 운영 가설은 단일 Gateway 프로세스이며, 응답 처리와 lane dispatch는 그 안에서 병렬 실행될 수 있다. 실제 배포 런처가 중복 Gateway 프로세스를 차단하는지는 미검증이다. Phase 1은 이 가정 아래 lock 없이 진행하고, 배포 모델이 여러 프로세스를 허용하면 lock 또는 동등한 조정을 다시 결정한다.

격리된 Herdr session에서 `[session] resume_agents_on_restore = true`를 설정하고 Pi agent를 실행·완료시킨 후 Herdr 서버를 stop/start했다. 복구된 workspace/pane에 Pi가 자동 재기동되었고 `agent_status: idle`, 동일한 `agent_session` 경로를 확인했다. 설정을 끄고 실행한 대조 실험에서는 pane은 복원됐지만 shell만 남아 `unknown`이었다. 따라서 Herdr 복구는 공식 integration 및 이 설정에 의존하며, Ragna 운영 설정에서 이를 명시·검증해야 한다.

실제 pi CLI의 설정된 `opencodex` provider로 무해한 exact-response 요청을 보내 응답을 받았다. credential 값은 출력하지 않았다. `openai-codex` 등 다른 provider는 not_ready였다. 후속 실험에서는 Pi의 동일한 loopback endpoint(`127.0.0.1:10100/v1`)와 loopback key를 환경변수로 주입하고, pi-ai의 OpenAI-compatible provider를 등록해 `pi-durable@1.1.0` Harness + JSONL에서 실제 모델 요청을 제출했다. submission은 `done`으로 끝났고 고유 응답 `RAGNA_DURABLE_HARNESS_AUTH_OK`를 transcript에서 읽었다. 이로써 실제 사용 중인 로컬 gateway 인증 설정을 Harness 경로에서도 사용할 수 있음을 검증했다. 구현 시에도 인증값을 저장소나 request trace에 기록하지 말고 프로세스 환경/credential adapter로 주입한다.

`agent-messenger@2.39.0`의 Discord bot SDK는 기존 로컬 bot profile로 인증했고 Discord Gateway listener가 연결됐다. 개인 사용자 `agent-discord` 프로필은 미인증이었다. Ragna 서버에서는 확인된 bot listener와 Gateway를 하나의 owning process에 두는 것을 기본 경계로 삼는다. 응답 처리와 lane dispatch는 같은 프로세스 안에서 병렬화할 수 있다. 배포 런처의 단일 인스턴스 보장은 미검증이며, Phase 1의 lock 없는 진행은 단일 프로세스 가정을 전제로 한다. 동일 프로세스에서 listener `start()`/`stop()`을 두 번 순차 호출해 두 번 모두 Discord Gateway 연결 성공을 확인했다. Owner 승인 후 `#coding`에 임시 bot 메시지를 전송하고 ID로 되읽은 뒤 삭제했다. 별도 실험에서는 live Discord listener가 해당 channel의 `message_create` 이벤트를 받아 message ID·channel·author·content를 출력했다. 해당 수신 probe도 삭제했다. 이어 Owner가 `#coding`에서 사람 응답 실험을 승인했다. Bot이 응답 요청을 게시하고, live listener가 실제 사람 작성 이벤트를 받아 author ID와 channel ID를 확인했다. 첫 응답은 요청 marker 대신 `하이`였고, 이후 bot mention 응답 이벤트도 도착했다. 따라서 사람-to-bot event 전달은 확인했으나, marker 일치 응답이나 운영 allowlist 필터는 검증하지 않았다. 해당 임시 probe 메시지는 삭제했다. pi-durable + 실제 provider 경로와 Herdr server restart 복구는 실험으로 통과했다. 남은 검증 항목은 배포 시 단일 Gateway 프로세스 보장, production listener/process lifecycle, 그리고 실제 owner reply를 포함한 승인된 test-surface다. Phase 0 통합 연동 증거는 충족했다. Phase 1의 durable direct-request trace는 단일 프로세스 가정 아래 OS-visible lock 없이 시작한다.

## 아직 결정되지 않은 사항

- Discord 결과 전달은 플랫폼이 제시한 재시도 대기 지침이 있으면 우선 따르고, 없으면 기본 간격으로 재시도한다. 기본 간격은 실험으로 정한다. 최대 4회 시도 후에도 실패하면 요청을 미종결·운영자 조치 필요 상태로 둔다. 운영자 조치 후 요청을 재개·대체 전달·종결하는 규칙은 미정.
- 실패 원인 영역별 분류 기준, 하위 흐름별 실패 재시도 정책, 실행 시작 여부 증거 및 사용자용 오류 형식.
- `agent-messenger`에서 Pi Durable Gateway로 메시지가 전달되는 구체적인 연결 방식과 프로세스 소유권.
- Ragna CLI process가 Pi Gateway 및 `pi-durable` Harness를 소유·구동하는 구체적 방식과 process lifecycle.
- 간단한 요청과 lane 위임 요청을 나누는 기준, 응답 지연 목표와 모델 선택은 후속 단계로 미룬다.
- 일반 후속 지시의 FIFO 큐는 합의했다. 급한 중단·방향 변경이 실제 실행을 어떻게 멈추거나 바꾸는지, 안전한 전달과 실제 수용을 어떤 증거로 확인할지는 추가 설계가 필요하다.
- chunk의 수집 시간과 최대 대기 시간은 초기 동작 실험에서 응답 지연과 chunk 크기를 관찰한 뒤 정한다.
- 여러 request를 하나의 Gateway 입력으로 제출할 때의 부분 처리·실패·재시도 규칙.
- 보고 배치 간격, 긴급 보고 종류, 중복 이벤트 식별과 읽기 확인 방식.
- Gateway가 소유자에게 완료 조건 또는 범위 조정을 요청한 뒤에도 검증 가능한 조건이 마련되지 않으면 요청을 보류한다. 추가 질문·범위 조정·위임 거절 중 어떤 대응을 할지는 미정이다. 조건의 의미적 품질을 자동 판정하지 않으므로, 의미 검토를 누가 맡을지도 미정이다.
- Dori의 기본 silence nudge/owner report 간격은 15분/20분이며 각각 침묵 구간에 한 번 동작한다. Ragna는 이를 초기 실험의 출발값으로 삼아 조정한다. 모니터링 경로 장애 시 복구하고 영향을 받은 lane의 상태를 확인할 때까지 작업을 완료로 처리하지 않는다. 정한 복구 대기 시간 내에 경로를 복구하지 못하면 소유자에게 알리고 복구를 계속 시도한다. 복구 대기 시간은 실험으로 정한다. blocker/question 보고의 모니터링·전달 신뢰성, 복수 작업 중 일부만 소유자 결정에 의존할 때의 세부 추적은 미정이다.
- 소유자 결정 요청을 전달한 뒤 답변이 없으면 Gateway는 결정 의존 작업을 대기시키고 소유자에게 다시 알린다. 재알림 간격은 실험으로 정한다. 결정과 무관한 작업은 계속 진행한다.
- 완료 조건 검증 실패 뒤 lane이 조용하거나 멈춘 경우 우선 Dori식 silence nudge, 장기 침묵 시 마지막 보고 전달, 멈춘 pane 감지 및 미완료 세션의 소유자 재시작 흐름을 따른다. Dori는 검증 실패 시 수정 이유를 lane에 알리고 다시 완료를 주장하게 하지만, 보완 요청이 무시될 때의 자동 반복 횟수나 추가 에스컬레이션은 확인되지 않았다. Ragna의 해당 처리 세부는 미정이다.
- 완료 결과 형식과 완료 후 cleanup 실패 처리.
- 기본 agent 지원 조건은 합의했다. 각 agent에서 공통으로 관측 가능한 시작·진행·중단·재개 신호와 capability 증거의 세부 표현.
- 저장소·event log 구현, 동시성, 보존·마이그레이션 정책.

## 구현 순서

스캐폴딩은 허용하되, 기능 완성은 실제 입력 표면에서 결과까지 이어지는 E2E 수직 슬라이스로 판단한다. 현재 스캐폴딩의 process entry인 `src/cli.ts`를 유지한다. 이 CLI process가 Pi Gateway와 `pi-durable` Harness를 사용하는 목표 구조로 전환 중이며, `src/index.ts`나 Pi extension entry는 만들지 않는다. 소스 구조는 얕게 유지하며, 중첩 Gateway layer나 추상적인 application/domain/adapters 폴더를 미리 만들지 않는다. `soul.md`, `user.md`, `memory.md`의 context 조립은 별도 책임으로 고려한다. `soul.md`, `user.md`, `memory.md`는 prompt/context assembly의 별도 입력으로 고려하되, 의미·우선순위·수정 주체·저장 정책은 아직 결정되지 않았다. `pi-durable`은 request/conversation trace의 SSOT이며, 이 파일들의 canonical storage로 정해진 것은 아니다. 첫 흐름은 승인된 테스트 표면의 direct response이며, 다음 흐름에서 같은 경로에 중복/재시작 복구를 추가한다. 그 뒤 Herdr 위임·검증, 모니터링·결정, 오류·재시도 정책을 각각 실행 가능한 E2E 흐름에 하나씩 더한다. 단위 테스트와 모듈은 지원 수단이지 완료 기준이 아니다. 외부 표면 접근이 허용되지 않으면 해당 slice는 미완료로 남긴다.

## 설계 게이트

- Agent 이름 목록을 인터페이스로 고정하지 말고, 실제 차이를 조사한 뒤 작은 수명주기 인터페이스를 설계한다.
- 검증은 작은 수직 흐름으로 나누고, 각 단계에서 실제 상태·복구 증거를 확인한 뒤 다음 단계로 진행한다.
- CLI process, `pi-durable`, Herdr, and each input/output surface are treated as separate responsibilities; verify their behavior from docs and real execution rather than assumption.
- 전송 요청, 전송 확인, agent 수락, 작업 완료 주장을 서로 다른 증거로 다룬다.
- 최소한 직접 응답 1건과 Herdr 위임 작업 1건을 수신부터 사용자 전달 확인까지 추적해 본 뒤 구조를 확정한다.
- 아직 인터뷰/설계 단계다. 이 메모만으로 제품 기능 구현이나 실제 Discord 메시지 전송을 시작하지 않는다.
