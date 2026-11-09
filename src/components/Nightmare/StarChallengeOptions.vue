<template>
  <section class="star-challenge-options" aria-label="星级挑战参数">
    <h3>星级挑战设置</h3>
    <p class="star-challenge-options__hint">
      默认使用游戏中每关保存的阵容；该关未保存阵容时会跳过，不会换成当前出战阵容。
    </p>

    <n-form-item label="选择关卡">
      <n-checkbox-group
        class="star-challenge-options__boss-group"
        :value="settings.starChallengeBossIds"
        @update:value="setValue('starChallengeBossIds', $event)"
      >
        <div class="star-challenge-options__bosses">
          <n-checkbox v-for="bossId in bossIds" :key="bossId" :value="bossId">
            第 {{ bossId }} 关
          </n-checkbox>
        </div>
      </n-checkbox-group>
    </n-form-item>

    <div class="star-challenge-options__grid">
      <n-form-item label="阵容来源">
        <n-radio-group
          :value="settings.starChallengeFormationSource"
          @update:value="setValue('starChallengeFormationSource', $event)"
        >
          <n-space wrap>
            <n-radio value="saved">游戏内已保存阵容</n-radio>
            <n-radio value="current">当前出战阵容</n-radio>
          </n-space>
        </n-radio-group>
      </n-form-item>

      <n-form-item label="每关最大挑战次数">
        <n-input-number
          :value="settings.starChallengeMaxAttempts"
          :min="1"
          :max="20"
          :precision="0"
          :input-props="{ 'aria-label': '每关最大挑战次数' }"
          @update:value="setValue('starChallengeMaxAttempts', $event)"
        />
      </n-form-item>

      <n-form-item label="目标星数">
        <n-select
          :value="settings.starChallengeTargetStars"
          :options="starOptions"
          aria-label="目标星数"
          @update:value="setValue('starChallengeTargetStars', $event)"
        />
      </n-form-item>

      <n-form-item label="自动领取可领星级奖励">
        <n-switch
          :value="settings.starChallengeClaimRewards"
          aria-label="自动领取星级奖励"
          @update:value="setValue('starChallengeClaimRewards', $event)"
        />
      </n-form-item>
    </div>
  </section>
</template>

<script setup>
import { computed } from "vue";
import { DEFAULT_STAR_CHALLENGE_OPTIONS } from "@/utils/starChallenge.js";

const props = defineProps({
  modelValue: {
    type: Object,
    default: () => ({}),
  },
});
const emit = defineEmits(["update:modelValue"]);

const bossIds = [1, 2, 3, 4, 5, 6, 7, 8];
const starOptions = [1, 2, 3].map((value) => ({ label: `${value} 星`, value }));
const settings = computed(() => ({
  ...DEFAULT_STAR_CHALLENGE_OPTIONS,
  ...props.modelValue,
  starChallengeBossIds: [...(props.modelValue.starChallengeBossIds || DEFAULT_STAR_CHALLENGE_OPTIONS.starChallengeBossIds)],
}));

const setValue = (key, value) => {
  if (value === null || value === undefined) return;
  emit("update:modelValue", { ...props.modelValue, [key]: value });
};
</script>

<style scoped>
.star-challenge-options {
  box-sizing: border-box;
  width: 100%;
  min-width: 0;
  padding: 14px;
  border: 1px solid var(--border-light, var(--n-border-color, #e4ebf4));
  border-radius: var(--border-radius-medium, 8px);
  background: var(--bg-primary, var(--n-color, #fff));
}

.star-challenge-options h3 {
  margin: 0 0 6px;
  color: var(--text-primary, var(--n-text-color, #15253f));
  font-size: 16px;
  font-weight: 650;
}

.star-challenge-options__hint {
  margin: 0 0 12px;
  color: var(--text-secondary, var(--n-text-color-3, #6e7c92));
  font-size: 13px;
  line-height: 1.5;
}

.star-challenge-options__boss-group {
  display: block;
  width: 100%;
  min-width: 0;
}

.star-challenge-options__bosses {
  display: grid;
  width: 100%;
  min-width: 0;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 8px;
}

.star-challenge-options__grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 220px), 1fr));
  gap: 0 16px;
}

@media (max-width: 480px) {
  .star-challenge-options {
    padding: 10px;
  }

  .star-challenge-options__bosses {
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 8px 6px;
  }

  .star-challenge-options__grid {
    grid-template-columns: minmax(0, 1fr);
  }
}

@media (max-width: 360px) {
  .star-challenge-options__bosses {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>
