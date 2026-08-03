"use client";

import { Switch } from "@/components/ui/switch";
import { useClientRegistrationPolicy } from "@/components/app/mobile-redesign/settings/use-client-registration-policy";

export function ClientRegistrationPolicySettings() {
  const { policy, updatePolicy } = useClientRegistrationPolicy();

  return (
    <div className="section-block" data-component="mobile_messages_client-registration-policy">
      <div className="section-header">고객 자동 등록</div>
      <div className="list-item">
        <div className="trigger-info">
          <div className="trigger-title">전자문서 생성 시 고객 자동 등록</div>
        </div>
        <Switch
          aria-label="전자문서 생성 시 고객 자동 등록"
          checked={policy?.clientAutoRegistration === true}
          disabled={!policy || updatePolicy.isPending}
          onCheckedChange={(checked) => updatePolicy.mutate({ clientAutoRegistration: checked })}
        />
      </div>
      <div className="list-item">
        <div className="trigger-info">
          <div className="trigger-title">자동 등록 시 인사 문자 발송</div>
        </div>
        <Switch
          aria-label="자동 등록 시 인사 문자 발송"
          checked={policy?.greetingOnAutoRegistration === true}
          disabled={!policy?.clientAutoRegistration || updatePolicy.isPending}
          onCheckedChange={(checked) => updatePolicy.mutate({ greetingOnAutoRegistration: checked })}
        />
      </div>
    </div>
  );
}
