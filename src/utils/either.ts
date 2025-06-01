/**
 * Either type system for explicit error handling
 */

export type Either<E, T> =
    | {
        error: E
        data: null
        success: false
    }
    | {
        error: null
        data: T
        success: true
    }

export function success<T>( data: T ): Either<never, T> {
    return {
        error: null,
        data,
        success: true,
    }
}

export function error<E>( error: E ): Either<E, never> {
    return {
        error,
        data: null,
        success: false,
    }
}

// Utilities
export function isSuccess<E, T>( either: Either<E, T> ): either is {
    error: null
    data: T
    success: true
} {
    return either.success === true
}

export function isError<E, T>( either: Either<E, T> ): either is {
    error: E
    data: null
    success: false
} {
    return either.success === false
}

export function map<E, T, U>( either: Either<E, T>, fn: ( value: T ) => U ): Either<E, U> {
    if ( isSuccess( either ) ) {
        return success( fn( either.data ) )
    }
    return either
}

export function flatMap<E, T, U>( either: Either<E, T>, fn: ( value: T ) => Either<E, U> ): Either<E, U> {
    if ( isSuccess( either ) ) {
        return fn( either.data )
    }
    return either
}
