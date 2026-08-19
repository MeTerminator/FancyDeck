import type { ComponentProps } from 'react'
import { cn } from '../lib/utils'

export const Card = ({ className, ...props }: ComponentProps<'div'>) => (
  <div
    data-slot="card"
    className={cn('bg-card text-card-foreground flex flex-col rounded-xl border shadow-xs', className)}
    {...props}
  />
)

export const CardHeader = ({ className, ...props }: ComponentProps<'div'>) => (
  <div data-slot="card-header" className={cn('flex flex-col gap-1 px-5 pt-5', className)} {...props} />
)

export const CardTitle = ({ className, ...props }: ComponentProps<'div'>) => (
  <div data-slot="card-title" className={cn('font-medium leading-none', className)} {...props} />
)

export const CardDescription = ({ className, ...props }: ComponentProps<'div'>) => (
  <div data-slot="card-description" className={cn('text-muted-foreground text-sm', className)} {...props} />
)

export const CardAction = ({ className, ...props }: ComponentProps<'div'>) => (
  <div data-slot="card-action" className={cn('ml-auto', className)} {...props} />
)

export const CardContent = ({ className, ...props }: ComponentProps<'div'>) => (
  <div data-slot="card-content" className={cn('p-5', className)} {...props} />
)

export const CardFooter = ({ className, ...props }: ComponentProps<'div'>) => (
  <div data-slot="card-footer" className={cn('flex items-center px-5 pb-5', className)} {...props} />
)
