import Joi from 'joi';

export interface RegistrationInput {
  teamName: string;
  collegeName: string;
  email: string;
  password: string;
  logoUrl?: string;
}

export interface LoginInput {
  email: string;
  password: string;
}

const registrationSchema = Joi.object<RegistrationInput>({
  teamName: Joi.string().min(3).max(50).required(),
  collegeName: Joi.string().min(3).max(50).required(),
  email: Joi.string().email().required(),
  password: Joi.string().min(6).max(100).required(),
  logoUrl: Joi.string().optional(),
});

const loginSchema = Joi.object<LoginInput>({
  email: Joi.string().email().required(),
  password: Joi.string().min(6).max(100).required(),
});

/** Called at the top of the registration controller; only the first error is reported. */
export const validateRegistration = (data: unknown) => registrationSchema.validate(data);

export const validateLogin = (data: unknown) => loginSchema.validate(data);
