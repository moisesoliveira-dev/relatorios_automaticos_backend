import { SetMetadata } from '@nestjs/common';

export const TABS_KEY = 'tabs';

/** Exige que o usuário tenha ao menos uma das abas informadas. */
export const Tabs = (...tabs: string[]) => SetMetadata(TABS_KEY, tabs);
