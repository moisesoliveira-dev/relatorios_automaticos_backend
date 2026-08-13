import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { TABS_KEY } from '../decorators/tabs.decorator';
import { SettingsService } from '../../settings/settings.service';
import { UserRole } from '../../users/entities/user.entity';
import { userCanAccessAnyTab } from '../../users/tabs.constants';

@Injectable()
export class TabsGuard implements CanActivate {
    constructor(
        private readonly reflector: Reflector,
        private readonly settingsService: SettingsService,
    ) { }

    async canActivate(context: ExecutionContext): Promise<boolean> {
        const requiredTabs = this.reflector.getAllAndOverride<string[]>(TABS_KEY, [
            context.getHandler(),
            context.getClass(),
        ]);

        if (!requiredTabs?.length) {
            return true;
        }

        const request = context.switchToHttp().getRequest();
        const user = request.user;
        if (!user?.sub) {
            throw new ForbiddenException('Acesso negado');
        }

        if (user.role === UserRole.MASTER) {
            return true;
        }

        const { tabs } = await this.settingsService.getNavigationTabsForUser(
            user.sub,
            user.role as UserRole,
        );

        if (!userCanAccessAnyTab(tabs, requiredTabs)) {
            throw new ForbiddenException('Você não tem permissão para acessar este recurso');
        }

        return true;
    }
}
